export type ToolType =
  | 'select'
  | 'hand'
  | 'rectangle'
  | 'diamond'
  | 'ellipse'
  | 'arrow'
  | 'freedraw'
  | 'text'
  | 'sticky'
  | 'eraser';

export type ElementType =
  | 'rectangle'
  | 'diamond'
  | 'ellipse'
  | 'arrow'
  | 'freedraw'
  | 'text'
  | 'sticky';

export type FillStyle = 'hachure' | 'solid' | 'cross-hatch';
export type StrokeStyle = 'solid' | 'dashed';
export type RoughnessStyle = 'rough' | 'clean';
export type AnchorSide = 'top' | 'right' | 'bottom' | 'left';
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  /** World X offset in screen pixels (screenX = worldX * zoom + x) */
  x: number;
  /** World Y offset in screen pixels (screenY = worldY * zoom + y) */
  y: number;
  /** Zoom scale factor */
  zoom: number;
}

export interface ArrowBinding {
  elementId: string;
  side: AnchorSide;
}

export interface ElementStyle {
  strokeColor: string;
  fillColor: string;
  fillStyle: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  roughness: RoughnessStyle;
  opacity: number;
  fontSize: number;
}

export interface BoardElement extends ElementStyle {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  seed: number;
  zIndex: number;
  text: string;
  /** For freedraw: points relative to (x, y); for arrow: [start, end] relative to (x, y) */
  points?: Point[];
  startBinding?: ArrowBinding | null;
  endBinding?: ArrowBinding | null;
  updatedAt: number;
}

export interface PeerUser {
  id: string;
  name: string;
  color: string;
}

export interface PeerAwarenessState {
  clientId: number;
  user: PeerUser;
  cursor: Point | null;
  selectedIds: string[];
  activeTool: ToolType;
  transport: 'local' | 'broadcast' | 'webrtc';
  lastSeen: number;
}

export interface WebRTCPeerConnectionInfo {
  peerId: string;
  label: string;
  state: RTCPeerConnectionState | 'waiting-answer';
  channelState: RTCDataChannelState | 'pending';
  createdAt: number;
}

export interface SyncEventLog {
  id: string;
  timestamp: number;
  direction: 'in' | 'out' | 'system';
  transport: 'local' | 'broadcast' | 'webrtc' | 'indexeddb';
  bytes: number;
  summary: string;
}

export interface SyncStats {
  clientId: number;
  roomId: string;
  broadcastConnected: boolean;
  indexedDbLoaded: boolean;
  webrtcPeerCount: number;
  totalPeers: number;
  updatesSent: number;
  updatesReceived: number;
  stateVectorEntries: Array<{ clientId: number; clock: number }>;
}

export type ThemeMode = 'light' | 'dark';
