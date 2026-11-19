import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import type {
  PeerAwarenessState,
  PeerUser,
  Point,
  SyncEventLog,
  SyncStats,
  ToolType,
  WebRTCPeerConnectionInfo,
} from '../types/board';
import { BoardCRDT, REMOTE_ORIGIN } from './crdtDoc';

type WireMessageType = 'sync-step1' | 'sync-step2' | 'update' | 'awareness' | 'leave';

interface WireEnvelope {
  type: WireMessageType;
  senderId: number;
  payload: number[];
}

interface SignalPayload {
  v: 1;
  roomId: string;
  peerName: string;
  sdp: RTCSessionDescriptionInit;
}

const DB_NAME = 'inkflow-p2p-crdt-v1';
const STORE_NAME = 'rooms';

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

function encodeBase64Json(obj: unknown): string {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decodeBase64Json<T>(code: string): T {
  const cleaned = code.trim().replace(/\s+/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as T;
}

function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 1800): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      pc.removeEventListener('icegatheringstatechange', onState);
      clearTimeout(timer);
      resolve();
    };
    const onState = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = window.setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onState);
  });
}

async function openIndexedDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return null;
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function loadRoomSnapshot(roomId: string): Promise<Uint8Array | null> {
  const db = await openIndexedDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(roomId);
      req.onsuccess = () => {
        const val = req.result;
        resolve(val instanceof Uint8Array ? val : null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function saveRoomSnapshot(roomId: string, data: Uint8Array): Promise<void> {
  const db = await openIndexedDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(data, roomId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

interface ActiveRtcPeer {
  peerId: string;
  label: string;
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  createdAt: number;
}

export class P2PSyncProvider {
  public readonly roomId: string;
  public readonly crdt: BoardCRDT;
  public readonly awareness: Awareness;

  private channel: BroadcastChannel | null = null;
  private rtcPeers = new Map<string, ActiveRtcPeer>();
  private peerTransportMap = new Map<number, 'broadcast' | 'webrtc'>();
  private listeners = new Set<() => void>();

  private updatesSent = 0;
  private updatesReceived = 0;
  private indexedDbLoaded = false;
  private saveTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private logs: SyncEventLog[] = [];
  private destroyed = false;

  private localUser: PeerUser;

  constructor(roomId: string, crdt: BoardCRDT, initialUser: PeerUser) {
    this.roomId = roomId;
    this.crdt = crdt;
    this.localUser = initialUser;
    this.awareness = new Awareness(crdt.doc);

    this.awareness.setLocalState({
      user: initialUser,
      cursor: null,
      selectedIds: [],
      activeTool: 'select' as ToolType,
      lastSeen: Date.now(),
    });

    this.crdt.doc.on('update', this.handleDocUpdate);
    this.awareness.on('update', this.handleAwarenessUpdate);

    this.initBroadcastChannel();

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.handleBeforeUnload);
      this.heartbeatTimer = window.setInterval(() => {
        this.broadcastAwarenessState();
        this.pruneStalePeers();
      }, 4500);
    }
  }

  /** Loads local IndexedDB state and asks BroadcastChannel peers for state vector diff */
  async hydrate(): Promise<{ loadedFromLocal: boolean }> {
    const saved = await loadRoomSnapshot(this.roomId);
    let loadedFromLocal = false;
    if (saved && saved.byteLength > 0 && !this.destroyed) {
      Y.applyUpdate(this.crdt.doc, saved, REMOTE_ORIGIN);
      loadedFromLocal = true;
      this.pushLog('in', 'indexeddb', saved.byteLength, '从本地 IndexedDB 恢复文档状态');
    }
    this.indexedDbLoaded = true;

    // Trigger initial BroadcastChannel sync handshake
    this.sendBroadcast({
      type: 'sync-step1',
      senderId: this.crdt.doc.clientID,
      payload: Array.from(Y.encodeStateVector(this.crdt.doc)),
    });
    this.broadcastAwarenessState();
    this.notify();
    return { loadedFromLocal };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    if (this.destroyed) return;
    this.listeners.forEach((fn) => fn());
  }

  private pushLog(
    direction: SyncEventLog['direction'],
    transport: SyncEventLog['transport'],
    bytes: number,
    summary: string,
  ): void {
    const entry: SyncEventLog = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      direction,
      transport,
      bytes,
      summary,
    };
    this.logs = [entry, ...this.logs].slice(0, 28);
  }

  private initBroadcastChannel(): void {
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      this.channel = new BroadcastChannel(`inkflow-p2p-room:${this.roomId}`);
      this.channel.onmessage = (event: MessageEvent<WireEnvelope>) => {
        this.handleIncomingMessage(event.data, 'broadcast');
      };
      this.pushLog('system', 'broadcast', 0, `已加入 BroadcastChannel 房间 #${this.roomId}`);
    } catch {
      this.channel = null;
    }
  }

  private sendBroadcast(envelope: WireEnvelope): void {
    if (!this.channel || this.destroyed) return;
    try {
      this.channel.postMessage(envelope);
    } catch {
      // Channel might be closed during teardown
    }
  }

  private sendToAllRtcPeers(envelope: WireEnvelope): void {
    if (this.rtcPeers.size === 0 || this.destroyed) return;
    const raw = JSON.stringify(envelope);
    this.rtcPeers.forEach((peer) => {
      if (peer.channel && peer.channel.readyState === 'open') {
        try {
          peer.channel.send(raw);
        } catch {
          // Ignore transient closed channel
        }
      }
    });
  }

  private handleDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (this.destroyed) return;

    this.schedulePersist();

    if (origin === REMOTE_ORIGIN) {
      this.notify();
      return;
    }

    const envelope: WireEnvelope = {
      type: 'update',
      senderId: this.crdt.doc.clientID,
      payload: Array.from(update),
    };
    this.updatesSent += 1;
    this.sendBroadcast(envelope);
    this.sendToAllRtcPeers(envelope);
    this.pushLog(
      'out',
      this.rtcPeers.size > 0 ? 'webrtc' : 'broadcast',
      update.byteLength,
      `广播 CRDT 增量 (${update.byteLength} B)`,
    );
    this.notify();
  };

  private handleAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    if (this.destroyed) return;
    if (origin === 'remote') {
      this.notify();
      return;
    }
    const changedClients = [...changes.added, ...changes.updated, ...changes.removed];
    if (changedClients.length === 0) return;
    const encoded = encodeAwarenessUpdate(this.awareness, changedClients);
    const envelope: WireEnvelope = {
      type: 'awareness',
      senderId: this.crdt.doc.clientID,
      payload: Array.from(encoded),
    };
    this.sendBroadcast(envelope);
    this.sendToAllRtcPeers(envelope);
    this.notify();
  };

  private broadcastAwarenessState(): void {
    if (this.destroyed) return;
    const encoded = encodeAwarenessUpdate(this.awareness, [this.crdt.doc.clientID]);
    const envelope: WireEnvelope = {
      type: 'awareness',
      senderId: this.crdt.doc.clientID,
      payload: Array.from(encoded),
    };
    this.sendBroadcast(envelope);
    this.sendToAllRtcPeers(envelope);
  }

  private handleIncomingMessage(
    msg: WireEnvelope,
    transport: 'broadcast' | 'webrtc',
    replyRtcChannel?: RTCDataChannel,
  ): void {
    if (!msg || msg.senderId === this.crdt.doc.clientID || this.destroyed) return;

    this.peerTransportMap.set(msg.senderId, transport);
    const bytes = new Uint8Array(msg.payload);

    if (msg.type === 'sync-step1') {
      // Peer sent its state vector -> compute minimal missing diff and reply
      const diff = Y.encodeStateAsUpdate(this.crdt.doc, bytes);
      const reply: WireEnvelope = {
        type: 'sync-step2',
        senderId: this.crdt.doc.clientID,
        payload: Array.from(diff),
      };
      if (replyRtcChannel && replyRtcChannel.readyState === 'open') {
        replyRtcChannel.send(JSON.stringify(reply));
      } else {
        this.sendBroadcast(reply);
      }
      // Also push our state vector back if needed & share awareness
      this.broadcastAwarenessState();
      this.pushLog('out', transport, diff.byteLength, `响应状态向量握手，发送差异 ${diff.byteLength} B`);
      this.notify();
      return;
    }

    if (msg.type === 'sync-step2' || msg.type === 'update') {
      if (bytes.byteLength > 0) {
        this.updatesReceived += 1;
        Y.applyUpdate(this.crdt.doc, bytes, REMOTE_ORIGIN);
        this.pushLog(
          'in',
          transport,
          bytes.byteLength,
          msg.type === 'sync-step2'
            ? `合并对端完整差异 (${bytes.byteLength} B)`
            : `接收 CRDT 实时更新 (${bytes.byteLength} B)`,
        );
      }
      this.notify();
      return;
    }

    if (msg.type === 'awareness') {
      applyAwarenessUpdate(this.awareness, bytes, 'remote');
      this.notify();
      return;
    }

    if (msg.type === 'leave') {
      removeAwarenessStates(this.awareness, [msg.senderId], 'remote');
      this.peerTransportMap.delete(msg.senderId);
      this.pushLog('system', transport, 0, `协作者 ${msg.senderId} 离开房间`);
      this.notify();
    }
  }

  private pruneStalePeers(): void {
    const now = Date.now();
    const staleIds: number[] = [];
    this.awareness.getStates().forEach((state, clientId) => {
      if (clientId === this.crdt.doc.clientID) return;
      const lastSeen = typeof state?.lastSeen === 'number' ? state.lastSeen : 0;
      if (lastSeen > 0 && now - lastSeen > 18000) {
        staleIds.push(clientId);
      }
    });
    if (staleIds.length > 0) {
      removeAwarenessStates(this.awareness, staleIds, 'remote');
      this.notify();
    }
  }

  private schedulePersist(): void {
    if (typeof window === 'undefined') return;
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      if (this.destroyed) return;
      const snapshot = Y.encodeStateAsUpdate(this.crdt.doc);
      void saveRoomSnapshot(this.roomId, snapshot);
    }, 320);
  }

  private handleBeforeUnload = (): void => {
    const leaveMsg: WireEnvelope = {
      type: 'leave',
      senderId: this.crdt.doc.clientID,
      payload: [],
    };
    this.sendBroadcast(leaveMsg);
    this.sendToAllRtcPeers(leaveMsg);
  };

  // --- Awareness local setters ---

  updateUser(partial: Partial<PeerUser>): void {
    this.localUser = { ...this.localUser, ...partial };
    const current = this.awareness.getLocalState() ?? {};
    this.awareness.setLocalState({
      ...current,
      user: this.localUser,
      lastSeen: Date.now(),
    });
  }

  updateCursor(cursor: Point | null): void {
    const current = this.awareness.getLocalState() ?? {};
    this.awareness.setLocalState({
      ...current,
      cursor,
      lastSeen: Date.now(),
    });
  }

  updateSelection(selectedIds: string[]): void {
    const current = this.awareness.getLocalState() ?? {};
    this.awareness.setLocalState({
      ...current,
      selectedIds,
      lastSeen: Date.now(),
    });
  }

  updateActiveTool(activeTool: ToolType): void {
    const current = this.awareness.getLocalState() ?? {};
    this.awareness.setLocalState({
      ...current,
      activeTool,
      lastSeen: Date.now(),
    });
  }

  // --- Serverless Native WebRTC P2P Handshake (Zero Backend Required) ---

  private attachDataChannel(peer: ActiveRtcPeer, channel: RTCDataChannel): void {
    peer.channel = channel;
    channel.onopen = () => {
      this.pushLog('system', 'webrtc', 0, `WebRTC DataChannel 已直连 (${peer.label})`);
      // Perform Yjs sync handshake over WebRTC DataChannel
      const step1: WireEnvelope = {
        type: 'sync-step1',
        senderId: this.crdt.doc.clientID,
        payload: Array.from(Y.encodeStateVector(this.crdt.doc)),
      };
      channel.send(JSON.stringify(step1));
      const fullUpdate: WireEnvelope = {
        type: 'sync-step2',
        senderId: this.crdt.doc.clientID,
        payload: Array.from(Y.encodeStateAsUpdate(this.crdt.doc)),
      };
      channel.send(JSON.stringify(fullUpdate));
      this.broadcastAwarenessState();
      this.notify();
    };

    channel.onmessage = (event: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(event.data) as WireEnvelope;
        this.handleIncomingMessage(msg, 'webrtc', channel);
      } catch {
        // Ignore malformed packet
      }
    };

    channel.onclose = () => {
      this.pushLog('system', 'webrtc', 0, `WebRTC 连接已关闭 (${peer.label})`);
      this.notify();
    };
  }

  /** Step 1 (Host): Generate a serverless WebRTC SDP Offer code to share with a friend */
  async createWebRTCOffer(): Promise<{ peerId: string; offerCode: string }> {
    if (typeof RTCPeerConnection === 'undefined') {
      throw new Error('当前浏览器环境不支持 WebRTC RTCPeerConnection');
    }

    const peerId = `rtc-${Math.random().toString(36).slice(2, 8)}`;
    const pc = new RTCPeerConnection(ICE_CONFIG);
    const peer: ActiveRtcPeer = {
      peerId,
      label: `节点 ${this.rtcPeers.size + 1}`,
      pc,
      channel: null,
      createdAt: Date.now(),
    };
    this.rtcPeers.set(peerId, peer);

    pc.onconnectionstatechange = () => this.notify();

    const dc = pc.createDataChannel('inkflow-yjs', { ordered: true });
    this.attachDataChannel(peer, dc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc, 1800);

    const localDesc = pc.localDescription;
    if (!localDesc) {
      throw new Error('未能生成本地 SDP 描述');
    }

    const payload: SignalPayload = {
      v: 1,
      roomId: this.roomId,
      peerName: this.localUser.name,
      sdp: { type: localDesc.type, sdp: localDesc.sdp },
    };

    this.pushLog('system', 'webrtc', 0, `已生成 WebRTC P2P 邀请码 (${peer.label})`);
    this.notify();
    return { peerId, offerCode: encodeBase64Json(payload) };
  }

  /** Step 2 (Guest): Paste Host's Offer code -> returns Answer code to send back */
  async acceptWebRTCOffer(offerCode: string): Promise<{ peerId: string; answerCode: string }> {
    if (typeof RTCPeerConnection === 'undefined') {
      throw new Error('当前浏览器环境不支持 WebRTC RTCPeerConnection');
    }

    let parsed: SignalPayload;
    try {
      parsed = decodeBase64Json<SignalPayload>(offerCode);
      if (!parsed || parsed.v !== 1 || parsed.sdp?.type !== 'offer') {
        throw new Error('invalid');
      }
    } catch {
      throw new Error('邀请码格式无效，请粘贴完整的 SDP Offer 邀请码');
    }

    const peerId = `rtc-${Math.random().toString(36).slice(2, 8)}`;
    const pc = new RTCPeerConnection(ICE_CONFIG);
    const peer: ActiveRtcPeer = {
      peerId,
      label: parsed.peerName || `远程节点 ${this.rtcPeers.size + 1}`,
      pc,
      channel: null,
      createdAt: Date.now(),
    };
    this.rtcPeers.set(peerId, peer);

    pc.onconnectionstatechange = () => this.notify();
    pc.ondatachannel = (event) => {
      this.attachDataChannel(peer, event.channel);
    };

    await pc.setRemoteDescription(new RTCSessionDescription(parsed.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceGathering(pc, 1800);

    const localDesc = pc.localDescription;
    if (!localDesc) {
      throw new Error('未能生成应答 SDP');
    }

    const answerPayload: SignalPayload = {
      v: 1,
      roomId: this.roomId,
      peerName: this.localUser.name,
      sdp: { type: localDesc.type, sdp: localDesc.sdp },
    };

    this.pushLog('system', 'webrtc', 0, `已接受 ${peer.label} 邀请，生成应答码`);
    this.notify();
    return { peerId, answerCode: encodeBase64Json(answerPayload) };
  }

  /** Step 3 (Host): Paste Guest's Answer code to finalize direct P2P RTCDataChannel */
  async completeWebRTCHandshake(peerId: string, answerCode: string): Promise<void> {
    const peer = this.rtcPeers.get(peerId);
    if (!peer) {
      throw new Error('未找到对应的待连接会话，请先生成邀请码');
    }

    let parsed: SignalPayload;
    try {
      parsed = decodeBase64Json<SignalPayload>(answerCode);
      if (!parsed || parsed.v !== 1 || parsed.sdp?.type !== 'answer') {
        throw new Error('invalid');
      }
    } catch {
      throw new Error('应答码格式无效，请粘贴好友生成的完整 SDP Answer 应答码');
    }

    if (parsed.peerName) {
      peer.label = parsed.peerName;
    }
    await peer.pc.setRemoteDescription(new RTCSessionDescription(parsed.sdp));
    this.pushLog('system', 'webrtc', 0, `已应用 ${peer.label} 应答码，正在建立 P2P 通道`);
    this.notify();
  }

  disconnectWebRTCPeer(peerId: string): void {
    const peer = this.rtcPeers.get(peerId);
    if (!peer) return;
    try {
      peer.channel?.close();
      peer.pc.close();
    } catch {
      // ignore
    }
    this.rtcPeers.delete(peerId);
    this.notify();
  }

  // --- Read-only snapshots for UI ---

  getPeers(): PeerAwarenessState[] {
    const list: PeerAwarenessState[] = [];
    this.awareness.getStates().forEach((state, clientId) => {
      if (!state || !state.user) return;
      const isLocal = clientId === this.crdt.doc.clientID;
      list.push({
        clientId,
        user: state.user as PeerUser,
        cursor: (state.cursor as Point | null) ?? null,
        selectedIds: Array.isArray(state.selectedIds) ? (state.selectedIds as string[]) : [],
        activeTool: (state.activeTool as ToolType) ?? 'select',
        transport: isLocal ? 'local' : (this.peerTransportMap.get(clientId) ?? 'broadcast'),
        lastSeen: typeof state.lastSeen === 'number' ? state.lastSeen : Date.now(),
      });
    });
    return list.sort((a, b) => {
      if (a.transport === 'local') return -1;
      if (b.transport === 'local') return 1;
      return a.clientId - b.clientId;
    });
  }

  getWebRTCPeers(): WebRTCPeerConnectionInfo[] {
    const list: WebRTCPeerConnectionInfo[] = [];
    this.rtcPeers.forEach((peer) => {
      const state =
        peer.pc.remoteDescription === null && peer.pc.localDescription?.type === 'offer'
          ? 'waiting-answer'
          : peer.pc.connectionState;
      list.push({
        peerId: peer.peerId,
        label: peer.label,
        state,
        channelState: peer.channel ? peer.channel.readyState : 'pending',
        createdAt: peer.createdAt,
      });
    });
    return list;
  }

  getLogs(): SyncEventLog[] {
    return this.logs;
  }

  getStats(): SyncStats {
    const peers = this.getPeers();
    const openRtcCount = Array.from(this.rtcPeers.values()).filter(
      (p) => p.channel?.readyState === 'open',
    ).length;
    return {
      clientId: this.crdt.doc.clientID,
      roomId: this.roomId,
      broadcastConnected: this.channel !== null,
      indexedDbLoaded: this.indexedDbLoaded,
      webrtcPeerCount: openRtcCount,
      totalPeers: peers.length,
      updatesSent: this.updatesSent,
      updatesReceived: this.updatesReceived,
      stateVectorEntries: this.crdt.getStateVectorEntries(),
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.handleBeforeUnload();

    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.handleBeforeUnload);
      if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
      if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    }

    this.crdt.doc.off('update', this.handleDocUpdate);
    this.awareness.off('update', this.handleAwarenessUpdate);
    this.awareness.destroy();

    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }

    this.rtcPeers.forEach((peer) => {
      try {
        peer.channel?.close();
        peer.pc.close();
      } catch {
        // ignore
      }
    });
    this.rtcPeers.clear();
    this.listeners.clear();
  }
}
