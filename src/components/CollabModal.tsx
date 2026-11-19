import React, { useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Link2,
  RefreshCw,
  Unplug,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import type {
  PeerAwarenessState,
  PeerUser,
  WebRTCPeerConnectionInfo,
} from '../types/board';
import { PEER_COLORS } from '../core/templates';

interface CollabModalProps {
  open: boolean;
  roomId: string;
  localUser: PeerUser;
  peers: PeerAwarenessState[];
  webrtcPeers: WebRTCPeerConnectionInfo[];
  onClose: () => void;
  onUpdateUser: (patch: Partial<PeerUser>) => void;
  onChangeRoom: (nextRoomId: string) => void;
  onCreateOffer: () => Promise<{ peerId: string; offerCode: string }>;
  onAcceptOffer: (offerCode: string) => Promise<{ peerId: string; answerCode: string }>;
  onCompleteHandshake: (peerId: string, answerCode: string) => Promise<void>;
  onDisconnectRtcPeer: (peerId: string) => void;
}

export const CollabModal: React.FC<CollabModalProps> = ({
  open,
  roomId,
  localUser,
  peers,
  webrtcPeers,
  onClose,
  onUpdateUser,
  onChangeRoom,
  onCreateOffer,
  onAcceptOffer,
  onCompleteHandshake,
  onDisconnectRtcPeer,
}) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [roomInput, setRoomInput] = useState(roomId);
  const [rtcMode, setRtcMode] = useState<'host' | 'guest'>('host');

  // Host WebRTC state
  const [pendingPeerId, setPendingPeerId] = useState<string | null>(null);
  const [generatedOffer, setGeneratedOffer] = useState('');
  const [incomingAnswer, setIncomingAnswer] = useState('');

  // Guest WebRTC state
  const [incomingOffer, setIncomingOffer] = useState('');
  const [generatedAnswer, setGeneratedAnswer] = useState('');

  const [rtcBusy, setRtcBusy] = useState(false);
  const [rtcMessage, setRtcMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  if (!open) return null;

  const shareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}#room=${encodeURIComponent(roomId)}`
      : `#room=${roomId}`;

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      setRtcMessage({ type: 'error', text: '剪贴板写入受限，请手动选中复制。' });
    }
  };

  const handleRoomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = roomInput.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (cleaned && cleaned !== roomId) {
      onChangeRoom(cleaned);
    }
  };

  const handleRandomRoom = () => {
    const next = `studio-${Math.random().toString(36).slice(2, 7)}`;
    setRoomInput(next);
    onChangeRoom(next);
  };

  const handleGenerateOffer = async () => {
    setRtcBusy(true);
    setRtcMessage(null);
    try {
      const { peerId, offerCode } = await onCreateOffer();
      setPendingPeerId(peerId);
      setGeneratedOffer(offerCode);
      setRtcMessage({
        type: 'success',
        text: '已生成 WebRTC SDP 邀请码。将其发送给好友，并把好友返回的应答码粘贴到下方即可直连。',
      });
    } catch (err) {
      setRtcMessage({
        type: 'error',
        text: err instanceof Error ? err.message : '生成邀请码失败',
      });
    } finally {
      setRtcBusy(false);
    }
  };

  const handleCompleteAnswer = async () => {
    if (!pendingPeerId || !incomingAnswer.trim()) {
      setRtcMessage({ type: 'error', text: '请先生成邀请码并粘贴好友返回的应答码。' });
      return;
    }
    setRtcBusy(true);
    setRtcMessage(null);
    try {
      await onCompleteHandshake(pendingPeerId, incomingAnswer);
      setIncomingAnswer('');
      setGeneratedOffer('');
      setPendingPeerId(null);
      setRtcMessage({
        type: 'success',
        text: '应答码已应用，正在建立点对点 RTCDataChannel 同步通道。',
      });
    } catch (err) {
      setRtcMessage({
        type: 'error',
        text: err instanceof Error ? err.message : '握手失败，请检查应答码是否完整',
      });
    } finally {
      setRtcBusy(false);
    }
  };

  const handleAcceptOffer = async () => {
    if (!incomingOffer.trim()) {
      setRtcMessage({ type: 'error', text: '请先粘贴好友发来的 SDP 邀请码。' });
      return;
    }
    setRtcBusy(true);
    setRtcMessage(null);
    try {
      const { answerCode } = await onAcceptOffer(incomingOffer);
      setGeneratedAnswer(answerCode);
      setRtcMessage({
        type: 'success',
        text: '已生成应答码，请复制并发回给发起方，对方确认后即刻实时同步。',
      });
    } catch (err) {
      setRtcMessage({
        type: 'error',
        text: err instanceof Error ? err.message : '解析邀请码失败',
      });
    } finally {
      setRtcBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="collab-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4 dark:border-zinc-800">
          <div>
            <h2
              id="collab-modal-title"
              className="text-base font-semibold text-stone-900 dark:text-zinc-100"
            >
              无后端 P2P 多人联机
            </h2>
            <p className="mt-0.5 text-xs text-stone-500 dark:text-zinc-400">
              基于 Yjs CRDT · 同浏览器 BroadcastChannel 秒级同步 · 跨设备 WebRTC 点对点直连
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭多人联机窗口"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {/* Section 1: Identity & Room */}
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <label
                htmlFor="collab-username"
                className="mb-1.5 block text-xs font-medium text-stone-700 dark:text-zinc-300"
              >
                我的协同昵称与光标颜色
              </label>
              <input
                id="collab-username"
                type="text"
                maxLength={20}
                value={localUser.name}
                onChange={(e) => onUpdateUser({ name: e.target.value })}
                placeholder="输入昵称"
                className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:border-blue-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
              <div className="mt-2.5 flex items-center gap-2">
                {PEER_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`选择光标颜色 ${color}`}
                    onClick={() => onUpdateUser({ color })}
                    style={{ backgroundColor: color }}
                    className={`h-6 w-6 rounded-full transition-transform ${
                      localUser.color === color
                        ? 'scale-110 ring-2 ring-blue-600 ring-offset-2 dark:ring-offset-zinc-900'
                        : 'hover:scale-105'
                    }`}
                  />
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="collab-room-id"
                className="mb-1.5 block text-xs font-medium text-stone-700 dark:text-zinc-300"
              >
                协同房间号（URL Hash 隔离）
              </label>
              <form onSubmit={handleRoomSubmit} className="flex gap-2">
                <input
                  id="collab-room-id"
                  type="text"
                  value={roomInput}
                  onChange={(e) => setRoomInput(e.target.value)}
                  className="font-mono-tabular min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:border-blue-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
                <button
                  type="submit"
                  className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-medium whitespace-nowrap text-stone-700 transition-colors hover:bg-stone-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  切换
                </button>
                <button
                  type="button"
                  onClick={handleRandomRoom}
                  aria-label="随机生成新房间"
                  title="随机生成新房间"
                  className="flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-lg border border-stone-300 text-stone-600 transition-colors hover:bg-stone-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              </form>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => copyText('room-url', shareUrl)}
                  className="flex items-center gap-1.5 rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-medium whitespace-nowrap text-white transition-colors hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  {copiedKey === 'room-url' ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      已复制链接
                    </>
                  ) : (
                    <>
                      <Link2 className="h-3.5 w-3.5" />
                      复制房间链接
                    </>
                  )}
                </button>
                <a
                  href={shareUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium whitespace-nowrap text-stone-700 transition-colors hover:bg-stone-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  新标签页同屏测试
                </a>
              </div>
            </div>
          </div>

          <div className="h-px bg-stone-200 dark:bg-zinc-800" />

          {/* Section 2: Serverless WebRTC Direct P2P Pairing */}
          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Wifi className="h-4 w-4 text-blue-600" />
                <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                  跨设备纯 WebRTC 点对点直连（无需信令服务器）
                </h3>
              </div>
              <div className="flex rounded-lg bg-stone-100 p-1 dark:bg-zinc-800">
                <button
                  type="button"
                  onClick={() => {
                    setRtcMode('host');
                    setRtcMessage(null);
                  }}
                  className={`rounded-md px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                    rtcMode === 'host'
                      ? 'bg-white text-stone-950 shadow-xs dark:bg-zinc-700 dark:text-zinc-50'
                      : 'text-stone-600 dark:text-zinc-400'
                  }`}
                >
                  1. 发起直连
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRtcMode('guest');
                    setRtcMessage(null);
                  }}
                  className={`rounded-md px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                    rtcMode === 'guest'
                      ? 'bg-white text-stone-950 shadow-xs dark:bg-zinc-700 dark:text-zinc-50'
                      : 'text-stone-600 dark:text-zinc-400'
                  }`}
                >
                  2. 接受邀请
                </button>
              </div>
            </div>

            {rtcMode === 'host' ? (
              <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-950/60">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-stone-600 dark:text-zinc-400">
                    步骤一：创建本地 RTCPeerConnection 与 DataChannel，生成 SDP 邀请码
                  </span>
                  <button
                    type="button"
                    disabled={rtcBusy}
                    onClick={handleGenerateOffer}
                    className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-medium whitespace-nowrap text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                  >
                    {rtcBusy ? '正在收集 ICE 候选...' : '生成 P2P 邀请码'}
                  </button>
                </div>

                {generatedOffer && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-stone-700 dark:text-zinc-300">
                        SDP Offer 邀请码（发送给好友）
                      </span>
                      <button
                        type="button"
                        onClick={() => copyText('offer', generatedOffer)}
                        className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
                      >
                        {copiedKey === 'offer' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        {copiedKey === 'offer' ? '已复制' : '复制邀请码'}
                      </button>
                    </div>
                    <textarea
                      readOnly
                      rows={3}
                      value={generatedOffer}
                      data-testid="webrtc-offer-output"
                      className="font-mono-tabular w-full rounded-lg border border-stone-300 bg-white p-2 text-[11px] text-stone-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                    />
                  </div>
                )}

                <div className="space-y-1.5 pt-1">
                  <label
                    htmlFor="webrtc-answer-input"
                    className="block text-xs font-medium text-stone-700 dark:text-zinc-300"
                  >
                    步骤二：粘贴好友返回的 SDP Answer 应答码完成直连
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="webrtc-answer-input"
                      type="text"
                      value={incomingAnswer}
                      onChange={(e) => setIncomingAnswer(e.target.value)}
                      placeholder="粘贴好友发回的应答码..."
                      className="font-mono-tabular min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs text-stone-900 focus:border-blue-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    />
                    <button
                      type="button"
                      disabled={rtcBusy || !pendingPeerId}
                      onClick={handleCompleteAnswer}
                      className="rounded-lg bg-stone-900 px-3.5 py-2 text-xs font-medium whitespace-nowrap text-white transition-colors hover:bg-stone-800 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                    >
                      建立直连
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-950/60">
                <div className="space-y-1.5">
                  <label
                    htmlFor="webrtc-offer-input"
                    className="block text-xs font-medium text-stone-700 dark:text-zinc-300"
                  >
                    步骤一：粘贴好友发来的 SDP Offer 邀请码
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="webrtc-offer-input"
                      type="text"
                      value={incomingOffer}
                      onChange={(e) => setIncomingOffer(e.target.value)}
                      placeholder="粘贴邀请码..."
                      className="font-mono-tabular min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs text-stone-900 focus:border-blue-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    />
                    <button
                      type="button"
                      disabled={rtcBusy}
                      onClick={handleAcceptOffer}
                      className="rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium whitespace-nowrap text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                    >
                      {rtcBusy ? '生成中...' : '生成应答码'}
                    </button>
                  </div>
                </div>

                {generatedAnswer && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-stone-700 dark:text-zinc-300">
                        步骤二：复制此 SDP Answer 应答码发回给发起方
                      </span>
                      <button
                        type="button"
                        onClick={() => copyText('answer', generatedAnswer)}
                        className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
                      >
                        {copiedKey === 'answer' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        {copiedKey === 'answer' ? '已复制' : '复制应答码'}
                      </button>
                    </div>
                    <textarea
                      readOnly
                      rows={3}
                      value={generatedAnswer}
                      className="font-mono-tabular w-full rounded-lg border border-stone-300 bg-white p-2 text-[11px] text-stone-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                    />
                  </div>
                )}
              </div>
            )}

            {rtcMessage && (
              <p
                role="status"
                className={`mt-2.5 text-xs ${
                  rtcMessage.type === 'error'
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-emerald-700 dark:text-emerald-400'
                }`}
              >
                {rtcMessage.text}
              </p>
            )}
          </div>

          <div className="h-px bg-stone-200 dark:bg-zinc-800" />

          {/* Section 3: Active Collaborators & WebRTC Channels */}
          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-zinc-100">
                <Users className="h-4 w-4 text-stone-500" />
                <span>房间协作者 ({peers.length})</span>
              </div>
              <span className="text-xs text-stone-500 dark:text-zinc-400">
                自动同步画布元素与实时光标
              </span>
            </div>

            <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 dark:divide-zinc-800 dark:border-zinc-800">
              {peers.map((peer) => (
                <li
                  key={peer.clientId}
                  className="flex items-center justify-between px-3.5 py-2.5 text-sm"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      style={{ backgroundColor: peer.user.color }}
                      className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white"
                    >
                      {peer.user.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div>
                      <div className="font-medium text-stone-900 dark:text-zinc-100">
                        {peer.user.name}
                        {peer.transport === 'local' ? '（当前标签页）' : ''}
                      </div>
                      <div className="font-mono-tabular text-[11px] text-stone-500 dark:text-zinc-400">
                        ClientID {peer.clientId} ·{' '}
                        {peer.transport === 'local'
                          ? '本机主控'
                          : peer.transport === 'webrtc'
                            ? 'WebRTC DataChannel'
                            : 'BroadcastChannel 同源多标签'}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {webrtcPeers.length > 0 && (
              <div className="mt-3">
                <div className="mb-1.5 text-xs font-medium text-stone-600 dark:text-zinc-400">
                  WebRTC 点对点会话
                </div>
                <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 dark:divide-zinc-800 dark:border-zinc-800">
                  {webrtcPeers.map((rtc) => (
                    <li
                      key={rtc.peerId}
                      className="flex items-center justify-between px-3.5 py-2 text-xs"
                    >
                      <div className="text-stone-700 dark:text-zinc-300">
                        <span className="font-medium">{rtc.label}</span>
                        <span className="mx-2 text-stone-400">·</span>
                        <span className="font-mono-tabular text-stone-500 dark:text-zinc-400">
                          ICE: {rtc.state} / Channel: {rtc.channelState}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onDisconnectRtcPeer(rtc.peerId)}
                        className="flex items-center gap-1 rounded px-2 py-1 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                      >
                        <Unplug className="h-3.5 w-3.5" />
                        断开
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
