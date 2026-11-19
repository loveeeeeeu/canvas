import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AnchorSide,
  ArrowBinding,
  BoardElement,
  ElementStyle,
  PeerAwarenessState,
  Point,
  ResizeHandle,
  ThemeMode,
  ToolType,
  Viewport,
} from '../types/board';
import {
  RectBounds,
  applyResize,
  findNearestAnchor,
  findTopmostElementAtPoint,
  getElementBounds,
  getElementsInSelectionBox,
  hitTestResizeHandle,
  normalizeRect,
  resolveArrowEndpoints,
  screenToWorld,
  simplifyFreehandPoints,
  worldToScreen,
  zoomAtPoint,
} from '../core/geometry';
import { renderScene } from '../canvas/roughRenderer';
import { BoardCRDT } from '../sync/crdtDoc';

interface WhiteboardCanvasProps {
  crdt: BoardCRDT;
  elements: BoardElement[];
  activeTool: ToolType;
  currentStyle: ElementStyle;
  viewport: Viewport;
  selectedIds: string[];
  peers: PeerAwarenessState[];
  localClientId: number;
  showGrid: boolean;
  theme: ThemeMode;
  onViewportChange: (next: Viewport) => void;
  onSelectionChange: (ids: string[]) => void;
  onSelectTool: (tool: ToolType) => void;
  onCursorMove: (worldPt: Point | null) => void;
  onCanvasResize?: (size: { width: number; height: number }) => void;
}

type InteractionState =
  | { mode: 'idle' }
  | { mode: 'panning'; startScreen: Point; startViewport: Viewport }
  | {
      mode: 'drawing';
      element: BoardElement;
      startWorld: Point;
      rawPoints: Point[];
    }
  | {
      mode: 'dragging';
      startWorld: Point;
      initialElements: Map<string, BoardElement>;
      moved: boolean;
    }
  | {
      mode: 'resizing';
      elementId: string;
      handle: ResizeHandle;
      startWorld: Point;
      initialBounds: RectBounds;
    }
  | {
      mode: 'marquee';
      startWorld: Point;
      currentWorld: Point;
    }
  | {
      mode: 'erasing';
      erasedIds: Set<string>;
    };

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function makeSeed(): number {
  return Math.floor(Math.random() * 2147483640) + 1;
}

export const WhiteboardCanvas: React.FC<WhiteboardCanvasProps> = ({
  crdt,
  elements,
  activeTool,
  currentStyle,
  viewport,
  selectedIds,
  peers,
  localClientId,
  showGrid,
  theme,
  onViewportChange,
  onSelectionChange,
  onSelectTool,
  onCursorMove,
  onCanvasResize,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const interactionRef = useRef<InteractionState>({ mode: 'idle' });
  const lastCursorSentRef = useRef<number>(0);

  const [canvasSize, setCanvasSize] = useState({ width: 1200, height: 800 });
  const [draftElement, setDraftElement] = useState<BoardElement | null>(null);
  const [marqueeBox, setMarqueeBox] = useState<RectBounds | null>(null);
  const [hoveredAnchor, setHoveredAnchor] = useState<{
    elementId: string;
    side: AnchorSide;
    point: Point;
  } | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);

  // Inline text editor state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Measure container dynamically
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      const size = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
      setCanvasSize(size);
      onCanvasResize?.(size);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onCanvasResize]);

  // Track Spacebar for quick canvas panning
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !editingId && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        setSpacePressed(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacePressed(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [editingId]);

  // Focus inline text editor when activated
  useEffect(() => {
    if (editingId && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [editingId]);

  const commitTextEdit = useCallback(() => {
    if (!editingId) return;
    const existing = crdt.getElement(editingId);
    if (existing) {
      const trimmed = editingText;
      if (existing.type === 'text' && !trimmed.trim()) {
        crdt.deleteElements([editingId]);
      } else {
        crdt.patchElement(editingId, { text: trimmed });
      }
    }
    setEditingId(null);
  }, [crdt, editingId, editingText]);

  // Paint scene on canvas whenever state changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.round(canvasSize.width * dpr);
    const targetH = Math.round(canvasSize.height * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    const remoteSelections = peers
      .filter((p) => p.clientId !== localClientId && p.selectedIds.length > 0)
      .map((p) => ({
        color: p.user.color,
        name: p.user.name,
        ids: p.selectedIds,
      }));

    renderScene({
      ctx,
      canvas,
      width: canvasSize.width,
      height: canvasSize.height,
      viewport,
      elements,
      draftElement,
      selectedIds,
      remoteSelections,
      marqueeBox,
      hoveredAnchor,
      showAnchorPorts: activeTool === 'arrow',
      editingElementId: editingId,
      showGrid,
      theme,
    });

    ctx.restore();
  }, [
    canvasSize,
    viewport,
    elements,
    draftElement,
    selectedIds,
    peers,
    localClientId,
    marqueeBox,
    hoveredAnchor,
    activeTool,
    editingId,
    showGrid,
    theme,
  ]);

  const getLocalScreenPoint = (e: React.PointerEvent | React.WheelEvent | React.MouseEvent): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    return {
      x: e.clientX - (rect?.left ?? 0),
      y: e.clientY - (rect?.top ?? 0),
    };
  };

  const broadcastCursorThrottled = (worldPt: Point | null) => {
    const now = performance.now();
    if (worldPt === null || now - lastCursorSentRef.current > 36) {
      lastCursorSentRef.current = now;
      onCursorMove(worldPt);
    }
  };

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const screenPt = getLocalScreenPoint(e);
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= 4) {
        // Pinch or mouse wheel zooms smoothly around cursor
        const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        onViewportChange(zoomAtPoint(viewport, screenPt, viewport.zoom * zoomFactor));
      } else {
        onViewportChange({
          ...viewport,
          x: viewport.x - e.deltaX,
          y: viewport.y - e.deltaY,
        });
      }
    },
    [viewport, onViewportChange],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (editingId) {
      commitTextEdit();
    }

    const screenPt = getLocalScreenPoint(e);
    const worldPt = screenToWorld(screenPt, viewport);

    e.currentTarget.setPointerCapture(e.pointerId);

    // Middle click, Hand tool, or Space+Click pans canvas
    if (e.button === 1 || activeTool === 'hand' || spacePressed) {
      interactionRef.current = {
        mode: 'panning',
        startScreen: screenPt,
        startViewport: { ...viewport },
      };
      return;
    }

    if (e.button !== 0) return;

    // Eraser tool
    if (activeTool === 'eraser') {
      const hit = findTopmostElementAtPoint(elements, worldPt, 10 / viewport.zoom);
      const erasedIds = new Set<string>();
      if (hit) {
        erasedIds.add(hit.id);
        crdt.deleteElements([hit.id]);
      }
      interactionRef.current = { mode: 'erasing', erasedIds };
      return;
    }

    // Text tool: click to place & open inline editor immediately
    if (activeTool === 'text') {
      const newEl: BoardElement = {
        ...currentStyle,
        id: makeId('txt'),
        type: 'text',
        x: worldPt.x,
        y: worldPt.y - 14,
        width: 220,
        height: 36,
        seed: makeSeed(),
        zIndex: crdt.getNextZIndex(),
        text: '',
        fillColor: 'transparent',
        fontSize: 18,
        updatedAt: Date.now(),
      };
      crdt.upsertElement(newEl);
      onSelectionChange([newEl.id]);
      setEditingId(newEl.id);
      setEditingText('');
      onSelectTool('select');
      return;
    }

    // Select tool
    if (activeTool === 'select') {
      // 1. Check resize handle if single element selected
      if (selectedIds.length === 1) {
        const selEl = elements.find((el) => el.id === selectedIds[0]);
        if (selEl && selEl.type !== 'arrow' && selEl.type !== 'freedraw') {
          const bounds = getElementBounds(selEl);
          const handle = hitTestResizeHandle(bounds, worldPt, viewport.zoom);
          if (handle) {
            interactionRef.current = {
              mode: 'resizing',
              elementId: selEl.id,
              handle,
              startWorld: worldPt,
              initialBounds: bounds,
            };
            return;
          }
        }
      }

      // 2. Check element hit
      const hit = findTopmostElementAtPoint(elements, worldPt, 8 / viewport.zoom);
      if (hit) {
        let nextSelection = selectedIds;
        if (e.shiftKey) {
          nextSelection = selectedIds.includes(hit.id)
            ? selectedIds.filter((id) => id !== hit.id)
            : [...selectedIds, hit.id];
        } else if (!selectedIds.includes(hit.id)) {
          nextSelection = [hit.id];
        }
        onSelectionChange(nextSelection);

        const initialElements = new Map<string, BoardElement>();
        elements.forEach((el) => {
          if (nextSelection.includes(el.id)) {
            initialElements.set(el.id, { ...el, points: el.points ? [...el.points] : undefined });
          }
        });

        interactionRef.current = {
          mode: 'dragging',
          startWorld: worldPt,
          initialElements,
          moved: false,
        };
        return;
      }

      // 3. Empty canvas -> start marquee selection
      onSelectionChange([]);
      interactionRef.current = {
        mode: 'marquee',
        startWorld: worldPt,
        currentWorld: worldPt,
      };
      setMarqueeBox({ x: worldPt.x, y: worldPt.y, width: 0, height: 0 });
      return;
    }

    // Drawing tools: rectangle, diamond, ellipse, sticky, arrow, freedraw
    const zIndex = crdt.getNextZIndex();
    if (activeTool === 'freedraw') {
      const el: BoardElement = {
        ...currentStyle,
        id: makeId('pen'),
        type: 'freedraw',
        x: worldPt.x,
        y: worldPt.y,
        width: 1,
        height: 1,
        seed: makeSeed(),
        zIndex,
        text: '',
        points: [{ x: 0, y: 0 }],
        updatedAt: Date.now(),
      };
      interactionRef.current = {
        mode: 'drawing',
        element: el,
        startWorld: worldPt,
        rawPoints: [{ x: 0, y: 0 }],
      };
      setDraftElement(el);
      return;
    }

    if (activeTool === 'arrow') {
      const anchor = findNearestAnchor(elements, worldPt, 24 / viewport.zoom);
      const startPt = anchor ? anchor.point : worldPt;
      const startBinding: ArrowBinding | null = anchor
        ? { elementId: anchor.elementId, side: anchor.side }
        : null;

      const el: BoardElement = {
        ...currentStyle,
        id: makeId('arr'),
        type: 'arrow',
        x: startPt.x,
        y: startPt.y,
        width: 0,
        height: 0,
        seed: makeSeed(),
        zIndex,
        text: '',
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
        startBinding,
        endBinding: null,
        updatedAt: Date.now(),
      };
      interactionRef.current = {
        mode: 'drawing',
        element: el,
        startWorld: startPt,
        rawPoints: [],
      };
      setDraftElement(el);
      return;
    }

    // Shapes: rectangle, diamond, ellipse, sticky
    const shapeType = activeTool;
    const isSticky = shapeType === 'sticky';
    const el: BoardElement = {
      ...currentStyle,
      fillColor: isSticky && currentStyle.fillColor === 'transparent' ? '#fef3c7' : currentStyle.fillColor,
      fillStyle: isSticky ? 'solid' : currentStyle.fillStyle,
      id: makeId(shapeType.slice(0, 4)),
      type: shapeType,
      x: worldPt.x,
      y: worldPt.y,
      width: 1,
      height: 1,
      seed: makeSeed(),
      zIndex,
      text: '',
      updatedAt: Date.now(),
    };
    interactionRef.current = {
      mode: 'drawing',
      element: el,
      startWorld: worldPt,
      rawPoints: [],
    };
    setDraftElement(el);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const screenPt = getLocalScreenPoint(e);
    const worldPt = screenToWorld(screenPt, viewport);

    broadcastCursorThrottled(worldPt);

    const state = interactionRef.current;

    if (activeTool === 'arrow') {
      const excludeId =
        state.mode === 'drawing' ? state.element.startBinding?.elementId : undefined;
      const near = findNearestAnchor(elements, worldPt, 24 / viewport.zoom, excludeId);
      setHoveredAnchor(near);
    } else if (hoveredAnchor) {
      setHoveredAnchor(null);
    }

    if (state.mode === 'idle') return;

    if (state.mode === 'panning') {
      onViewportChange({
        ...state.startViewport,
        x: state.startViewport.x + (screenPt.x - state.startScreen.x),
        y: state.startViewport.y + (screenPt.y - state.startScreen.y),
      });
      return;
    }

    if (state.mode === 'erasing') {
      const hit = findTopmostElementAtPoint(elements, worldPt, 10 / viewport.zoom);
      if (hit && !state.erasedIds.has(hit.id)) {
        state.erasedIds.add(hit.id);
        crdt.deleteElements([hit.id]);
      }
      return;
    }

    if (state.mode === 'marquee') {
      state.currentWorld = worldPt;
      setMarqueeBox({
        x: state.startWorld.x,
        y: state.startWorld.y,
        width: worldPt.x - state.startWorld.x,
        height: worldPt.y - state.startWorld.y,
      });
      return;
    }

    if (state.mode === 'dragging') {
      const dx = worldPt.x - state.startWorld.x;
      const dy = worldPt.y - state.startWorld.y;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        state.moved = true;
      }
      const updatedBatch: BoardElement[] = [];
      state.initialElements.forEach((initEl) => {
        if (initEl.type === 'arrow') {
          updatedBatch.push({
            ...initEl,
            x: initEl.x + dx,
            y: initEl.y + dy,
            startBinding: null,
            endBinding: null,
          });
        } else {
          updatedBatch.push({
            ...initEl,
            x: initEl.x + dx,
            y: initEl.y + dy,
          });
        }
      });
      crdt.upsertElements(updatedBatch);
      return;
    }

    if (state.mode === 'resizing') {
      const dx = worldPt.x - state.startWorld.x;
      const dy = worldPt.y - state.startWorld.y;
      const nextBounds = applyResize(state.initialBounds, state.handle, dx, dy, 32);
      crdt.patchElement(state.elementId, {
        x: nextBounds.x,
        y: nextBounds.y,
        width: nextBounds.width,
        height: nextBounds.height,
      });
      return;
    }

    if (state.mode === 'drawing') {
      const el = state.element;
      if (el.type === 'freedraw') {
        const rel = { x: worldPt.x - el.x, y: worldPt.y - el.y };
        state.rawPoints.push(rel);
        const xs = state.rawPoints.map((p) => p.x);
        const ys = state.rawPoints.map((p) => p.y);
        const updated: BoardElement = {
          ...el,
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
          points: [...state.rawPoints],
        };
        state.element = updated;
        setDraftElement(updated);
        return;
      }

      if (el.type === 'arrow') {
        const snapTarget = findNearestAnchor(
          elements,
          worldPt,
          24 / viewport.zoom,
          el.startBinding?.elementId,
        );
        const endPt = snapTarget ? snapTarget.point : worldPt;
        const updated: BoardElement = {
          ...el,
          width: endPt.x - state.startWorld.x,
          height: endPt.y - state.startWorld.y,
          points: [
            { x: 0, y: 0 },
            { x: endPt.x - state.startWorld.x, y: endPt.y - state.startWorld.y },
          ],
          endBinding: snapTarget
            ? { elementId: snapTarget.elementId, side: snapTarget.side }
            : null,
        };
        state.element = updated;
        setDraftElement(updated);
        return;
      }

      const norm = normalizeRect(
        state.startWorld.x,
        state.startWorld.y,
        worldPt.x - state.startWorld.x,
        worldPt.y - state.startWorld.y,
      );
      const updated: BoardElement = {
        ...el,
        x: norm.x,
        y: norm.y,
        width: norm.width,
        height: norm.height,
      };
      state.element = updated;
      setDraftElement(updated);
    }
  };

  const handlePointerUp = () => {
    const state = interactionRef.current;
    interactionRef.current = { mode: 'idle' };

    if (state.mode === 'marquee') {
      const box = {
        x: state.startWorld.x,
        y: state.startWorld.y,
        width: state.currentWorld.x - state.startWorld.x,
        height: state.currentWorld.y - state.startWorld.y,
      };
      if (Math.abs(box.width) > 4 || Math.abs(box.height) > 4) {
        const hits = getElementsInSelectionBox(elements, box);
        onSelectionChange(hits.map((h) => h.id));
      }
      setMarqueeBox(null);
      return;
    }

    if (state.mode === 'drawing') {
      const el = state.element;
      setDraftElement(null);

      if (el.type === 'freedraw') {
        const simplified = simplifyFreehandPoints(state.rawPoints, 3);
        if (simplified.length >= 2) {
          // Normalize origin to min point so bounding box & hit tests stay exact
          const minX = Math.min(...simplified.map((p) => p.x));
          const minY = Math.min(...simplified.map((p) => p.y));
          const maxX = Math.max(...simplified.map((p) => p.x));
          const maxY = Math.max(...simplified.map((p) => p.y));
          const normalized: BoardElement = {
            ...el,
            x: el.x + minX,
            y: el.y + minY,
            width: Math.max(maxX - minX, 4),
            height: Math.max(maxY - minY, 4),
            points: simplified.map((p) => ({ x: p.x - minX, y: p.y - minY })),
          };
          crdt.upsertElement(normalized);
          onSelectionChange([normalized.id]);
        }
        return;
      }

      if (el.type === 'arrow') {
        const dist = Math.hypot(el.width, el.height);
        if (dist >= 12 || (el.startBinding && el.endBinding)) {
          crdt.upsertElement(el);
          onSelectionChange([el.id]);
          onSelectTool('select');
        }
        return;
      }

      // If user clicked instead of dragging, create a nicely sized default node
      const finalEl: BoardElement =
        el.width < 14 && el.height < 14
          ? {
              ...el,
              width: el.type === 'sticky' ? 180 : el.type === 'diamond' ? 140 : 160,
              height: el.type === 'sticky' ? 120 : el.type === 'diamond' ? 104 : 76,
            }
          : el;

      crdt.upsertElement(finalEl);
      onSelectionChange([finalEl.id]);
      onSelectTool('select');
    }
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const screenPt = getLocalScreenPoint(e);
    const worldPt = screenToWorld(screenPt, viewport);
    const hit = findTopmostElementAtPoint(elements, worldPt, 10 / viewport.zoom);
    if (hit && hit.type !== 'freedraw') {
      onSelectionChange([hit.id]);
      setEditingId(hit.id);
      setEditingText(hit.text);
    }
  };

  // Compute screen position for inline text editor
  const editingElement = editingId ? elements.find((el) => el.id === editingId) ?? null : null;
  let editorStyle: React.CSSProperties | null = null;
  if (editingElement) {
    const byId = new Map(elements.map((e) => [e.id, e]));
    if (editingElement.type === 'arrow') {
      const { start, end } = resolveArrowEndpoints(editingElement, byId);
      const midScreen = worldToScreen(
        { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
        viewport,
      );
      editorStyle = {
        left: midScreen.x - 80,
        top: midScreen.y - 18,
        width: 160,
        height: 36,
        fontSize: `${Math.max(12, editingElement.fontSize * viewport.zoom)}px`,
      };
    } else {
      const b = getElementBounds(editingElement, byId);
      const topLeft = worldToScreen({ x: b.x, y: b.y }, viewport);
      editorStyle = {
        left: topLeft.x,
        top: topLeft.y,
        width: Math.max(120, b.width * viewport.zoom),
        height: Math.max(40, b.height * viewport.zoom),
        fontSize: `${Math.max(12, editingElement.fontSize * viewport.zoom)}px`,
      };
    }
  }

  const cursorClass =
    spacePressed || activeTool === 'hand'
      ? 'cursor-grab active:cursor-grabbing'
      : activeTool === 'select'
        ? 'cursor-default'
        : activeTool === 'eraser'
          ? 'cursor-cell'
          : 'cursor-crosshair';

  const remotePeers = peers.filter((p) => p.clientId !== localClientId && p.cursor !== null);

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onPointerLeave={() => broadcastCursorThrottled(null)}
      className="relative h-full w-full overflow-hidden select-none"
    >
      <canvas
        ref={canvasRef}
        data-testid="whiteboard-canvas"
        aria-label="协同手绘白板画布"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        className={`block h-full w-full ${cursorClass}`}
      />

      {/* Inline Text Editor Overlay */}
      {editingElement && editorStyle && (
        <textarea
          ref={textareaRef}
          aria-label="编辑图元文本"
          data-testid="inline-text-editor"
          value={editingText}
          onChange={(e) => setEditingText(e.target.value)}
          onBlur={commitTextEdit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              commitTextEdit();
            } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              commitTextEdit();
            }
          }}
          style={editorStyle}
          className={`absolute z-30 resize-none rounded-md border-2 border-blue-600 bg-white/95 p-2 text-stone-900 shadow-md outline-none dark:bg-zinc-900/95 dark:text-zinc-100 ${
            editingElement.type === 'text' || editingElement.type === 'sticky'
              ? 'text-left'
              : 'text-center'
          } ${editingElement.roughness === 'rough' ? 'font-sketch' : ''}`}
        />
      )}

      {/* Remote Collaborator Live Cursors */}
      <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
        {remotePeers.map((peer) => {
          if (!peer.cursor) return null;
          const pos = worldToScreen(peer.cursor, viewport);
          if (
            pos.x < -60 ||
            pos.y < -60 ||
            pos.x > canvasSize.width + 60 ||
            pos.y > canvasSize.height + 60
          ) {
            return null;
          }
          return (
            <div
              key={peer.clientId}
              data-testid={`remote-cursor-${peer.clientId}`}
              style={{
                transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
              }}
              className="absolute top-0 left-0 transition-transform duration-75 ease-out"
            >
              <svg
                width="18"
                height="20"
                viewBox="0 0 18 20"
                fill="none"
                className="-translate-x-0.5 -translate-y-0.5 drop-shadow-xs"
              >
                <path
                  d="M1 1L7.2 17.8L10 11.2L16.5 8.5L1 1Z"
                  fill={peer.user.color}
                  stroke="#ffffff"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
              <div
                style={{ backgroundColor: peer.user.color }}
                className="mt-0.5 ml-3 rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-white shadow-xs"
              >
                {peer.user.name}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
