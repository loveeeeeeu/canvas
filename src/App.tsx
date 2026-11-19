import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BoardElement,
  ElementStyle,
  PeerAwarenessState,
  PeerUser,
  Point,
  SyncEventLog,
  SyncStats,
  ThemeMode,
  ToolType,
  Viewport,
  WebRTCPeerConnectionInfo,
} from './types/board';
import {
  BOARD_TEMPLATES,
  DEFAULT_STYLE,
  PEER_COLORS,
  createP2PArchitectureTemplate,
} from './core/templates';
import { fitElementsToViewport, zoomAtPoint } from './core/geometry';
import {
  exportBoardAsJSON,
  exportBoardAsPNG,
  exportBoardAsSVG,
  parseImportedBoardJSON,
} from './core/exportUtils';
import { BoardCRDT } from './sync/crdtDoc';
import { P2PSyncProvider } from './sync/p2pProvider';
import { Toolbar } from './components/Toolbar';
import { TopBar } from './components/TopBar';
import { StyleInspector } from './components/StyleInspector';
import { ZoomControls } from './components/ZoomControls';
import { CollabModal } from './components/CollabModal';
import { CrdtInspector } from './components/CrdtInspector';
import { WhiteboardCanvas } from './components/WhiteboardCanvas';

const DEFAULT_ROOM_ID = 'inkflow-demo';

function readRoomIdFromHash(): string {
  if (typeof window === 'undefined') return DEFAULT_ROOM_ID;
  const hash = window.location.hash;
  const match = hash.match(/room=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : DEFAULT_ROOM_ID;
}

function writeRoomIdToHash(roomId: string): void {
  if (typeof window === 'undefined') return;
  const nextHash = `#room=${encodeURIComponent(roomId)}`;
  if (window.location.hash !== nextHash) {
    window.history.replaceState(null, '', nextHash);
  }
}

function createInitialUser(): PeerUser {
  const adjectives = ['画师', '架构师', '工程师', '设计师', '极客'];
  const suffix = Math.floor(10 + Math.random() * 89);
  const storedName =
    typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('inkflow-username') : null;
  const storedColor =
    typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('inkflow-usercolor') : null;

  return {
    id: Math.random().toString(36).slice(2, 10),
    name: storedName || `${adjectives[suffix % adjectives.length]} #${suffix}`,
    color: storedColor || PEER_COLORS[suffix % PEER_COLORS.length],
  };
}

export default function App() {
  const [roomId, setRoomId] = useState<string>(() => {
    const initial = readRoomIdFromHash();
    writeRoomIdToHash(initial);
    return initial;
  });

  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('inkflow-theme');
      if (saved === 'dark' || saved === 'light') return saved;
    }
    return 'light';
  });

  const [showGrid, setShowGrid] = useState(true);
  const [activeTool, setActiveTool] = useState<ToolType>('select');
  const [currentStyle, setCurrentStyle] = useState<ElementStyle>(DEFAULT_STYLE);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [viewport, setViewport] = useState<Viewport>({ x: 140, y: 120, zoom: 1 });
  const [canvasSize, setCanvasSize] = useState({ width: 1280, height: 800 });

  const [localUser, setLocalUser] = useState<PeerUser>(createInitialUser);
  const [collabOpen, setCollabOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const crdtRef = useRef<BoardCRDT | null>(null);
  const providerRef = useRef<P2PSyncProvider | null>(null);
  const hasAutoFitRef = useRef(false);
  const toastTimerRef = useRef<number | null>(null);

  const [elements, setElements] = useState<BoardElement[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [peers, setPeers] = useState<PeerAwarenessState[]>([]);
  const [webrtcPeers, setWebrtcPeers] = useState<WebRTCPeerConnectionInfo[]>([]);
  const [logs, setLogs] = useState<SyncEventLog[]>([]);
  const [stats, setStats] = useState<SyncStats>({
    clientId: 0,
    roomId,
    broadcastConnected: false,
    indexedDbLoaded: false,
    webrtcPeerCount: 0,
    totalPeers: 1,
    updatesSent: 0,
    updatesReceived: 0,
    stateVectorEntries: [],
  });
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  // Sync Tailwind dark class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('inkflow-theme', theme);
    }
  }, [theme]);

  // Listen for URL hash room switches
  useEffect(() => {
    const onHashChange = () => {
      const next = readRoomIdFromHash();
      setRoomId((prev) => (prev === next ? prev : next));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Mount & tear down BoardCRDT + P2PSyncProvider per roomId
  useEffect(() => {
    writeRoomIdToHash(roomId);
    hasAutoFitRef.current = false;

    const crdt = new BoardCRDT();
    const provider = new P2PSyncProvider(roomId, crdt, localUser);
    crdtRef.current = crdt;
    providerRef.current = provider;

    const syncReactState = () => {
      const nextElements = crdt.getElements();
      setElements(nextElements);
      setPeers(provider.getPeers());
      setWebrtcPeers(provider.getWebRTCPeers());
      setLogs(provider.getLogs());
      setStats(provider.getStats());
      setCanUndo(crdt.canUndo());
      setCanRedo(crdt.canRedo());
    };

    const unsubProvider = provider.subscribe(syncReactState);
    const onMapChange = () => syncReactState();
    crdt.elementsMap.observe(onMapChange);

    syncReactState();

    let cancelled = false;
    setIsHydrated(false);
    void provider.hydrate().then(({ loadedFromLocal }) => {
      if (cancelled) return;
      // Wait briefly for BroadcastChannel peers to answer before seeding default room
      window.setTimeout(() => {
        if (cancelled) return;
        if (!loadedFromLocal && crdt.getElements().length === 0) {
          crdt.seedIfEmpty(createP2PArchitectureTemplate());
        }
        syncReactState();
        setIsHydrated(true);
        if (!hasAutoFitRef.current && crdt.getElements().length > 0) {
          hasAutoFitRef.current = true;
          const elList = crdt.getElements();
          setViewport(
            fitElementsToViewport(
              elList,
              window.innerWidth,
              window.innerHeight,
              110,
            ),
          );
        }
      }, 140);
    });

    return () => {
      cancelled = true;
      unsubProvider();
      crdt.elementsMap.unobserve(onMapChange);
      provider.destroy();
      crdt.destroy();
      crdtRef.current = null;
      providerRef.current = null;
    };
    // Intentionally only re-initialize when roomId changes; user profile updates flow through provider.updateUser
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Keep provider awareness in sync with selection & tool
  useEffect(() => {
    providerRef.current?.updateSelection(selectedIds);
  }, [selectedIds]);

  useEffect(() => {
    providerRef.current?.updateActiveTool(activeTool);
  }, [activeTool]);

  const handleUpdateUser = useCallback((patch: Partial<PeerUser>) => {
    setLocalUser((prev) => {
      const next = { ...prev, ...patch };
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('inkflow-username', next.name);
        sessionStorage.setItem('inkflow-usercolor', next.color);
      }
      providerRef.current?.updateUser(next);
      return next;
    });
  }, []);

  const handleCursorMove = useCallback((pt: Point | null) => {
    providerRef.current?.updateCursor(pt);
  }, []);

  const handleStyleChange = useCallback(
    (patch: Partial<ElementStyle>) => {
      setCurrentStyle((prev) => ({ ...prev, ...patch }));
      const crdt = crdtRef.current;
      if (!crdt || selectedIds.length === 0) return;
      const updated: BoardElement[] = [];
      for (const id of selectedIds) {
        const el = crdt.getElement(id);
        if (el) updated.push({ ...el, ...patch });
      }
      crdt.upsertElements(updated);
    },
    [selectedIds],
  );

  const handleDuplicateSelected = useCallback(() => {
    const crdt = crdtRef.current;
    if (!crdt || selectedIds.length === 0) return;
    let nextZ = crdt.getNextZIndex();
    const clones: BoardElement[] = [];
    for (const id of selectedIds) {
      const el = crdt.getElement(id);
      if (!el) continue;
      clones.push({
        ...el,
        id: `${el.type.slice(0, 4)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        x: el.x + 28,
        y: el.y + 28,
        zIndex: nextZ++,
        seed: Math.floor(Math.random() * 2147483640) + 1,
        startBinding: null,
        endBinding: null,
        updatedAt: Date.now(),
      });
    }
    crdt.upsertElements(clones);
    setSelectedIds(clones.map((c) => c.id));
  }, [selectedIds]);

  const handleDeleteSelected = useCallback(() => {
    const crdt = crdtRef.current;
    if (!crdt || selectedIds.length === 0) return;
    crdt.deleteElements(selectedIds);
    setSelectedIds([]);
  }, [selectedIds]);

  const handleFitView = useCallback(() => {
    setViewport(fitElementsToViewport(elements, canvasSize.width, canvasSize.height, 110));
  }, [elements, canvasSize]);

  const handleZoomIn = useCallback(() => {
    setViewport((vp) =>
      zoomAtPoint(vp, { x: canvasSize.width / 2, y: canvasSize.height / 2 }, vp.zoom * 1.2),
    );
  }, [canvasSize]);

  const handleZoomOut = useCallback(() => {
    setViewport((vp) =>
      zoomAtPoint(vp, { x: canvasSize.width / 2, y: canvasSize.height / 2 }, vp.zoom / 1.2),
    );
  }, [canvasSize]);

  const handleZoomReset = useCallback(() => {
    setViewport((vp) =>
      zoomAtPoint(vp, { x: canvasSize.width / 2, y: canvasSize.height / 2 }, 1),
    );
  }, [canvasSize]);

  const handleUndo = useCallback(() => {
    crdtRef.current?.undo();
  }, []);

  const handleRedo = useCallback(() => {
    crdtRef.current?.redo();
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditingInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;
      if (isEditingInput) return;

      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }

      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        handleDuplicateSelected();
        return;
      }

      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelectedIds(elements.map((el) => el.id));
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.length > 0) {
          e.preventDefault();
          handleDeleteSelected();
        }
        return;
      }

      if (e.key === 'Escape') {
        setSelectedIds([]);
        setActiveTool('select');
        setCollabOpen(false);
        return;
      }

      if (e.shiftKey && e.key === '!') {
        e.preventDefault();
        handleFitView();
        return;
      }

      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        handleZoomIn();
        return;
      }
      if (e.key === '-') {
        e.preventDefault();
        handleZoomOut();
        return;
      }

      if (mod) return;

      const toolMap: Record<string, ToolType> = {
        v: 'select',
        h: 'hand',
        r: 'rectangle',
        d: 'diamond',
        o: 'ellipse',
        a: 'arrow',
        p: 'freedraw',
        t: 'text',
        s: 'sticky',
        e: 'eraser',
      };
      const mapped = toolMap[e.key.toLowerCase()];
      if (mapped) {
        setActiveTool(mapped);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    elements,
    selectedIds,
    handleUndo,
    handleRedo,
    handleDuplicateSelected,
    handleDeleteSelected,
    handleFitView,
    handleZoomIn,
    handleZoomOut,
  ]);

  const handleLoadTemplate = (templateId: string) => {
    const tpl = BOARD_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl || !crdtRef.current) return;
    crdtRef.current.replaceAllElements(tpl.elements);
    setSelectedIds([]);
    if (tpl.elements.length > 0) {
      setViewport(fitElementsToViewport(tpl.elements, canvasSize.width, canvasSize.height, 110));
    }
    showToast(`已加载模板：${tpl.name}`);
  };

  const handleImportJSON = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseImportedBoardJSON(String(reader.result ?? ''));
        crdtRef.current?.replaceAllElements(parsed);
        setSelectedIds([]);
        if (parsed.length > 0) {
          setViewport(fitElementsToViewport(parsed, canvasSize.width, canvasSize.height, 110));
        }
        showToast(`已导入 ${parsed.length} 个图元`);
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'JSON 解析失败');
      }
    };
    reader.readAsText(file);
  };

  const handleClearBoard = () => {
    crdtRef.current?.replaceAllElements([]);
    setSelectedIds([]);
    showToast('已清空当前画布（按 Ctrl+Z 可撤销）');
  };

  // Compute displayed style (reflect first selected element if any)
  const firstSelected =
    selectedIds.length > 0 ? elements.find((e) => e.id === selectedIds[0]) : undefined;
  const inspectorStyle: ElementStyle = firstSelected
    ? {
        strokeColor: firstSelected.strokeColor,
        fillColor: firstSelected.fillColor,
        fillStyle: firstSelected.fillStyle,
        strokeWidth: firstSelected.strokeWidth,
        strokeStyle: firstSelected.strokeStyle,
        roughness: firstSelected.roughness,
        opacity: firstSelected.opacity,
        fontSize: firstSelected.fontSize,
      }
    : currentStyle;

  const showStylePanel =
    selectedIds.length > 0 ||
    (activeTool !== 'select' && activeTool !== 'hand' && activeTool !== 'eraser');

  return (
    <main
      data-testid="whiteboard-app"
      data-room-id={roomId}
      data-element-count={elements.length}
      data-selected-count={selectedIds.length}
      data-peer-count={peers.length}
      data-tool={activeTool}
      data-theme={theme}
      className="relative h-screen w-screen overflow-hidden bg-[#faf9f6] text-stone-900 dark:bg-[#14161a] dark:text-zinc-100"
    >
      {/* Infinite Canvas Layer */}
      {crdtRef.current && (
        <WhiteboardCanvas
          crdt={crdtRef.current}
          elements={elements}
          activeTool={activeTool}
          currentStyle={currentStyle}
          viewport={viewport}
          selectedIds={selectedIds}
          peers={peers}
          localClientId={stats.clientId}
          showGrid={showGrid}
          theme={theme}
          onViewportChange={setViewport}
          onSelectionChange={setSelectedIds}
          onSelectTool={setActiveTool}
          onCursorMove={handleCursorMove}
          onCanvasResize={setCanvasSize}
        />
      )}

      {/* Top Floating Chrome */}
      <header className="pointer-events-none fixed top-4 right-4 left-4 z-40 flex items-start justify-between gap-3">
        <TopBar
          roomId={roomId}
          peers={peers}
          theme={theme}
          showGrid={showGrid}
          onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          onToggleGrid={() => setShowGrid((g) => !g)}
          onLoadTemplate={handleLoadTemplate}
          onExportPNG={() => {
            exportBoardAsPNG(elements, theme, roomId);
            showToast('已导出高清 PNG 图片');
          }}
          onExportSVG={() => {
            exportBoardAsSVG(elements, theme, roomId);
            showToast('已导出矢量 SVG 文件');
          }}
          onExportJSON={() => {
            exportBoardAsJSON(elements, roomId);
            showToast('已导出场景 JSON 文件');
          }}
          onImportJSON={handleImportJSON}
          onClearBoard={handleClearBoard}
          onOpenCollab={() => setCollabOpen(true)}
        />
      </header>

      {/* Center Floating Toolbar */}
      <div className="pointer-events-none fixed top-4 left-1/2 z-30 hidden -translate-x-1/2 lg:block">
        <Toolbar activeTool={activeTool} onSelectTool={setActiveTool} />
      </div>
      {/* Compact Toolbar row on narrower screens */}
      <div className="pointer-events-none fixed top-[68px] left-1/2 z-30 max-w-[calc(100vw-24px)] -translate-x-1/2 overflow-x-auto lg:hidden">
        <Toolbar activeTool={activeTool} onSelectTool={setActiveTool} />
      </div>

      {/* Left Contextual Style Inspector */}
      {showStylePanel && (
        <div className="pointer-events-none fixed top-20 left-4 z-20 hidden sm:block">
          <StyleInspector
            style={inspectorStyle}
            hasSelection={selectedIds.length > 0}
            selectionCount={selectedIds.length}
            onChangeStyle={handleStyleChange}
            onBringToFront={() => crdtRef.current?.bringToFront(selectedIds)}
            onSendToBack={() => crdtRef.current?.sendToBack(selectedIds)}
            onDuplicate={handleDuplicateSelected}
            onDelete={handleDeleteSelected}
          />
        </div>
      )}

      {/* Empty Canvas Prompt */}
      {isHydrated && elements.length === 0 && (
        <div className="pointer-events-none fixed inset-0 z-10 flex items-center justify-center">
          <div className="pointer-events-auto rounded-xl border border-stone-200 bg-white/90 px-6 py-5 text-center shadow-sm backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/90">
            <p className="text-sm font-medium text-stone-800 dark:text-zinc-200">
              画布为空，点击上方工具栏开始手绘或连线
            </p>
            <p className="mt-1 text-xs text-stone-500 dark:text-zinc-400">
              按 R 绘制矩形 · 按 A 绑定流程箭头 · 双击节点编辑文字
            </p>
            <button
              type="button"
              onClick={() => handleLoadTemplate('p2p-arch')}
              className="mt-3 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
            >
              加载 P2P 架构示例图
            </button>
          </div>
        </div>
      )}

      {/* Bottom Controls */}
      <ZoomControls
        zoom={viewport.zoom}
        canUndo={canUndo}
        canRedo={canRedo}
        inspectorOpen={inspectorOpen}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomReset={handleZoomReset}
        onFitView={handleFitView}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onToggleInspector={() => setInspectorOpen((o) => !o)}
      />

      {/* Toggleable CRDT Inspector */}
      <CrdtInspector
        open={inspectorOpen}
        stats={stats}
        elementCount={elements.length}
        logs={logs}
        onClose={() => setInspectorOpen(false)}
      />

      {/* P2P Collaboration Modal */}
      <CollabModal
        open={collabOpen}
        roomId={roomId}
        localUser={localUser}
        peers={peers}
        webrtcPeers={webrtcPeers}
        onClose={() => setCollabOpen(false)}
        onUpdateUser={handleUpdateUser}
        onChangeRoom={(next) => {
          setRoomId(next);
          showToast(`已切换到房间 #${next}`);
        }}
        onCreateOffer={() => {
          if (!providerRef.current) return Promise.reject(new Error('同步引擎未就绪'));
          return providerRef.current.createWebRTCOffer();
        }}
        onAcceptOffer={(code) => {
          if (!providerRef.current) return Promise.reject(new Error('同步引擎未就绪'));
          return providerRef.current.acceptWebRTCOffer(code);
        }}
        onCompleteHandshake={(peerId, answerCode) => {
          if (!providerRef.current) return Promise.reject(new Error('同步引擎未就绪'));
          return providerRef.current.completeWebRTCHandshake(peerId, answerCode);
        }}
        onDisconnectRtcPeer={(peerId) => providerRef.current?.disconnectWebRTCPeer(peerId)}
      />

      {/* Subtle Toast Notification */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-16 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-stone-200 bg-stone-900 px-4 py-2 text-xs font-medium text-white shadow-lg dark:border-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {toast}
        </div>
      )}
    </main>
  );
}
