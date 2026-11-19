import rough from 'roughjs';
import type { Drawable, Options as RoughOptions } from 'roughjs/bin/core';
import type {
  AnchorSide,
  BoardElement,
  Point,
  ThemeMode,
  Viewport,
} from '../types/board';
import {
  GRID_SIZE,
  RectBounds,
  cubicBezierPoint,
  getArrowCurveControlPoints,
  getElementAnchors,
  getElementBounds,
  getResizeHandlePositions,
  isConnectableElement,
  normalizeRect,
  resolveArrowEndpoints,
  sampleCubicBezier,
} from '../core/geometry';

const drawableCache = new Map<string, Drawable>();
const MAX_CACHE_SIZE = 800;

function getEffectiveStrokeColor(strokeColor: string, theme: ThemeMode): string {
  if (theme === 'dark' && strokeColor.toLowerCase() === '#1e293b') {
    return '#e2e8f0';
  }
  return strokeColor;
}

function getEffectiveFillColor(fillColor: string, theme: ThemeMode): string {
  if (fillColor === 'transparent') return 'transparent';
  if (theme === 'dark') {
    const map: Record<string, string> = {
      '#ffffff': '#1f242d',
      '#dbeafe': '#1e3a5f',
      '#d1fae5': '#144335',
      '#fef3c7': '#4a3715',
      '#ffe4e6': '#4c1d28',
      '#ede9fe': '#322354',
    };
    return map[fillColor.toLowerCase()] ?? fillColor;
  }
  return fillColor;
}

function getRoughOptions(el: BoardElement, theme: ThemeMode): RoughOptions {
  const stroke = getEffectiveStrokeColor(el.strokeColor, theme);
  const fill = getEffectiveFillColor(el.fillColor, theme);
  const isRough = el.roughness === 'rough';
  return {
    seed: el.seed,
    stroke,
    strokeWidth: el.strokeWidth,
    roughness: isRough ? 1.35 : 0.05,
    bowing: isRough ? 1.1 : 0,
    fill: fill === 'transparent' ? undefined : fill,
    fillStyle: el.fillStyle,
    fillWeight: Math.max(1, el.strokeWidth * 0.65),
    hachureGap: 7,
    strokeLineDash: el.strokeStyle === 'dashed' ? [8, 6] : undefined,
  };
}

function getCachedDrawable(
  key: string,
  factory: () => Drawable,
): Drawable {
  const existing = drawableCache.get(key);
  if (existing) return existing;
  if (drawableCache.size >= MAX_CACHE_SIZE) {
    drawableCache.clear();
  }
  const created = factory();
  drawableCache.set(key, created);
  return created;
}

function drawDotGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewport: Viewport,
  theme: ThemeMode,
): void {
  const step = GRID_SIZE * viewport.zoom;
  if (step < 8) return;

  const startX = ((viewport.x % step) + step) % step;
  const startY = ((viewport.y % step) + step) % step;

  ctx.save();
  ctx.fillStyle = theme === 'dark' ? 'rgba(148, 163, 184, 0.16)' : 'rgba(100, 116, 139, 0.22)';
  const radius = Math.max(0.8, Math.min(1.5, viewport.zoom * 1.1));

  for (let x = startX; x < width; x += step) {
    for (let y = startY; y < height; y += step) {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawMultilineText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  fontSize: number,
  color: string,
  align: CanvasTextAlign,
  isRough: boolean,
): void {
  if (!text.trim()) return;
  const fontFamily = isRough
    ? '"Kalam", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
    : '"Plus Jakarta Sans", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

  ctx.save();
  ctx.font = `500 ${fontSize}px ${fontFamily}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';

  const paragraphs = text.split('\n');
  const lines: string[] = [];

  for (const para of paragraphs) {
    if (!para) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const ch of para) {
      const candidate = current + ch;
      if (maxWidth > 20 && ctx.measureText(candidate).width > maxWidth && current.length > 0) {
        lines.push(current);
        current = ch;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }

  const lineHeight = fontSize * 1.38;
  const totalHeight = lines.length * lineHeight;
  const startY = y - totalHeight / 2 + lineHeight / 2;

  lines.forEach((line, idx) => {
    ctx.fillText(line, x, startY + idx * lineHeight);
  });
  ctx.restore();
}

function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  tip: Point,
  from: Point,
  color: string,
  strokeWidth: number,
): void {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const headLen = Math.max(10, strokeWidth * 4.5);
  const spread = Math.PI / 6.5;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(tip.x - headLen * Math.cos(angle - spread), tip.y - headLen * Math.sin(angle - spread));
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(tip.x - headLen * Math.cos(angle + spread), tip.y - headLen * Math.sin(angle + spread));
  ctx.stroke();
  ctx.restore();
}

function renderSingleElement(
  ctx: CanvasRenderingContext2D,
  rc: ReturnType<typeof rough.canvas>,
  el: BoardElement,
  elementsById: Map<string, BoardElement>,
  theme: ThemeMode,
  isEditingText: boolean,
): void {
  const stroke = getEffectiveStrokeColor(el.strokeColor, theme);
  const fill = getEffectiveFillColor(el.fillColor, theme);
  const options = getRoughOptions(el, theme);
  const isRough = el.roughness === 'rough';

  ctx.save();
  ctx.globalAlpha = el.opacity;

  if (el.type === 'rectangle' || el.type === 'sticky') {
    const b = normalizeRect(el.x, el.y, el.width, el.height);
    if (el.type === 'sticky') {
      ctx.save();
      ctx.shadowColor = theme === 'dark' ? 'rgba(0,0,0,0.45)' : 'rgba(15,23,42,0.10)';
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 5;
      ctx.fillStyle = fill === 'transparent' ? (theme === 'dark' ? '#4a3715' : '#fef3c7') : fill;
      ctx.beginPath();
      ctx.roundRect(b.x, b.y, b.width, b.height, 8);
      ctx.fill();
      ctx.restore();
    }

    const key = `${el.id}:${el.type}:${b.x}:${b.y}:${b.width}:${b.height}:${el.strokeColor}:${el.fillColor}:${el.fillStyle}:${el.strokeWidth}:${el.strokeStyle}:${el.roughness}:${el.seed}:${theme}`;
    const drawable = getCachedDrawable(key, () =>
      rc.generator.rectangle(
        b.x,
        b.y,
        b.width,
        b.height,
        el.type === 'sticky' ? { ...options, fill: undefined } : options,
      ),
    );
    rc.draw(drawable);

    if (!isEditingText && el.text) {
      const textX = el.type === 'sticky' ? b.x + 14 : b.x + b.width / 2;
      drawMultilineText(
        ctx,
        el.text,
        textX,
        b.y + b.height / 2,
        Math.max(b.width - 24, 40),
        el.fontSize,
        stroke,
        el.type === 'sticky' ? 'left' : 'center',
        isRough,
      );
    }
  } else if (el.type === 'diamond') {
    const b = normalizeRect(el.x, el.y, el.width, el.height);
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const poly: [number, number][] = [
      [cx, b.y],
      [b.x + b.width, cy],
      [cx, b.y + b.height],
      [b.x, cy],
    ];
    const key = `${el.id}:diamond:${b.x}:${b.y}:${b.width}:${b.height}:${el.strokeColor}:${el.fillColor}:${el.fillStyle}:${el.strokeWidth}:${el.strokeStyle}:${el.roughness}:${el.seed}:${theme}`;
    const drawable = getCachedDrawable(key, () => rc.generator.polygon(poly, options));
    rc.draw(drawable);

    if (!isEditingText && el.text) {
      drawMultilineText(
        ctx,
        el.text,
        cx,
        cy,
        Math.max(b.width * 0.62, 48),
        el.fontSize,
        stroke,
        'center',
        isRough,
      );
    }
  } else if (el.type === 'ellipse') {
    const b = normalizeRect(el.x, el.y, el.width, el.height);
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const key = `${el.id}:ellipse:${b.x}:${b.y}:${b.width}:${b.height}:${el.strokeColor}:${el.fillColor}:${el.fillStyle}:${el.strokeWidth}:${el.strokeStyle}:${el.roughness}:${el.seed}:${theme}`;
    const drawable = getCachedDrawable(key, () =>
      rc.generator.ellipse(cx, cy, Math.max(b.width, 4), Math.max(b.height, 4), options),
    );
    rc.draw(drawable);

    if (!isEditingText && el.text) {
      drawMultilineText(
        ctx,
        el.text,
        cx,
        cy,
        Math.max(b.width * 0.78, 48),
        el.fontSize,
        stroke,
        'center',
        isRough,
      );
    }
  } else if (el.type === 'arrow') {
    const { start, end } = resolveArrowEndpoints(el, elementsById);
    const { cp1, cp2, isCurved } = getArrowCurveControlPoints(
      start,
      end,
      el.startBinding?.side,
      el.endBinding?.side,
    );

    if (isRough) {
      const curvePts = isCurved
        ? sampleCubicBezier(start, cp1, cp2, end, 22).map((p) => [p.x, p.y] as [number, number])
        : ([
            [start.x, start.y],
            [end.x, end.y],
          ] as [number, number][]);

      const key = `${el.id}:arrow:${Math.round(start.x)}:${Math.round(start.y)}:${Math.round(end.x)}:${Math.round(end.y)}:${el.strokeColor}:${el.strokeWidth}:${el.strokeStyle}:${el.seed}:${theme}`;
      const drawable = getCachedDrawable(key, () =>
        rc.generator.linearPath(curvePts, {
          ...options,
          fill: undefined,
          roughness: 0.9,
        }),
      );
      rc.draw(drawable);
    } else {
      ctx.save();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = el.strokeWidth;
      ctx.lineCap = 'round';
      if (el.strokeStyle === 'dashed') ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      if (isCurved) {
        ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y);
      } else {
        ctx.lineTo(end.x, end.y);
      }
      ctx.stroke();
      ctx.restore();
    }

    const tangentFrom = isCurved ? cubicBezierPoint(start, cp1, cp2, end, 0.92) : start;
    drawArrowhead(ctx, end, tangentFrom, stroke, el.strokeWidth);

    if (!isEditingText && el.text) {
      const mid = isCurved
        ? cubicBezierPoint(start, cp1, cp2, end, 0.5)
        : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };

      const isMostlyHorizontal = Math.abs(end.y - start.y) < 35 && Math.abs(end.x - start.x) > 40;
      const labelY = isMostlyHorizontal ? mid.y - 16 : mid.y;

      ctx.save();
      const labelFont = `500 ${Math.max(12, el.fontSize - 1)}px "Plus Jakarta Sans", sans-serif`;
      ctx.font = labelFont;
      const metrics = ctx.measureText(el.text);
      const padX = 5;
      const boxW = metrics.width + padX * 2;
      const boxH = el.fontSize + 6;
      ctx.fillStyle = theme === 'dark' ? '#14161a' : '#faf9f6';
      ctx.fillRect(mid.x - boxW / 2, labelY - boxH / 2, boxW, boxH);
      ctx.restore();

      drawMultilineText(ctx, el.text, mid.x, labelY, 160, Math.max(12, el.fontSize - 1), stroke, 'center', isRough);
    }
  } else if (el.type === 'freedraw') {
    const pts = el.points ?? [];
    if (pts.length >= 2) {
      ctx.save();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = el.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (el.strokeStyle === 'dashed') ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(el.x + pts[0].x, el.y + pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const curr = { x: el.x + pts[i].x, y: el.y + pts[i].y };
        const next = { x: el.x + pts[i + 1].x, y: el.y + pts[i + 1].y };
        const midX = (curr.x + next.x) / 2;
        const midY = (curr.y + next.y) / 2;
        ctx.quadraticCurveTo(curr.x, curr.y, midX, midY);
      }
      const last = pts[pts.length - 1];
      ctx.lineTo(el.x + last.x, el.y + last.y);
      ctx.stroke();
      ctx.restore();
    }
  } else if (el.type === 'text') {
    if (!isEditingText && el.text) {
      const b = normalizeRect(el.x, el.y, Math.max(el.width, 80), Math.max(el.height, 28));
      drawMultilineText(
        ctx,
        el.text,
        b.x,
        b.y + b.height / 2,
        Math.max(b.width, 400),
        el.fontSize,
        stroke,
        'left',
        isRough,
      );
    }
  }

  ctx.restore();
}

export interface RenderSceneOptions {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  viewport: Viewport;
  elements: BoardElement[];
  draftElement: BoardElement | null;
  selectedIds: string[];
  remoteSelections: Array<{ color: string; name: string; ids: string[] }>;
  marqueeBox: RectBounds | null;
  hoveredAnchor: { elementId: string; side: AnchorSide; point: Point } | null;
  showAnchorPorts: boolean;
  editingElementId: string | null;
  showGrid: boolean;
  theme: ThemeMode;
}

export function renderScene(opts: RenderSceneOptions): void {
  const {
    ctx,
    canvas,
    width,
    height,
    viewport,
    elements,
    draftElement,
    selectedIds,
    remoteSelections,
    marqueeBox,
    hoveredAnchor,
    showAnchorPorts,
    editingElementId,
    showGrid,
    theme,
  } = opts;

  ctx.save();
  ctx.fillStyle = theme === 'dark' ? '#14161a' : '#faf9f6';
  ctx.fillRect(0, 0, width, height);

  if (showGrid) {
    drawDotGrid(ctx, width, height, viewport, theme);
  }

  // Apply world-to-screen transform
  ctx.translate(viewport.x, viewport.y);
  ctx.scale(viewport.zoom, viewport.zoom);

  const rc = rough.canvas(canvas);
  const allElements = draftElement ? [...elements, draftElement] : elements;
  const byId = new Map(allElements.map((e) => [e.id, e]));

  for (const el of allElements) {
    renderSingleElement(ctx, rc, el, byId, theme, el.id === editingElementId);
  }

  // Remote collaborator selection highlights
  for (const remote of remoteSelections) {
    for (const id of remote.ids) {
      const el = byId.get(id);
      if (!el) continue;
      const b = getElementBounds(el, byId);
      const pad = 5 / viewport.zoom;
      ctx.save();
      ctx.strokeStyle = remote.color;
      ctx.lineWidth = 1.5 / viewport.zoom;
      ctx.setLineDash([5 / viewport.zoom, 4 / viewport.zoom]);
      ctx.strokeRect(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2);
      ctx.restore();
    }
  }

  // Anchor ports when arrow tool is active
  if (showAnchorPorts) {
    const sides: AnchorSide[] = ['top', 'right', 'bottom', 'left'];
    for (const el of elements) {
      if (!isConnectableElement(el)) continue;
      const anchors = getElementAnchors(el);
      for (const side of sides) {
        const pt = anchors[side];
        const isHovered = hoveredAnchor?.elementId === el.id && hoveredAnchor?.side === side;
        ctx.save();
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, (isHovered ? 6.5 : 4.2) / viewport.zoom, 0, Math.PI * 2);
        ctx.fillStyle = isHovered ? '#2563eb' : theme === 'dark' ? '#1e293b' : '#ffffff';
        ctx.fill();
        ctx.lineWidth = 1.8 / viewport.zoom;
        ctx.strokeStyle = '#2563eb';
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  // Local selection frames & resize handles
  const selectedElements = selectedIds
    .map((id) => byId.get(id))
    .filter((e): e is BoardElement => Boolean(e));

  for (const el of selectedElements) {
    const b = getElementBounds(el, byId);
    const pad = 6 / viewport.zoom;
    ctx.save();
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1.5 / viewport.zoom;
    ctx.strokeRect(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2);
    ctx.restore();
  }

  // Single non-arrow/non-freedraw element gets 8 resize handles
  if (
    selectedElements.length === 1 &&
    selectedElements[0].type !== 'arrow' &&
    selectedElements[0].type !== 'freedraw'
  ) {
    const b = getElementBounds(selectedElements[0], byId);
    const handles = getResizeHandlePositions(b);
    const size = 8 / viewport.zoom;
    ctx.save();
    ctx.fillStyle = theme === 'dark' ? '#14161a' : '#ffffff';
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1.6 / viewport.zoom;
    Object.values(handles).forEach((pt) => {
      ctx.fillRect(pt.x - size / 2, pt.y - size / 2, size, size);
      ctx.strokeRect(pt.x - size / 2, pt.y - size / 2, size, size);
    });
    ctx.restore();
  }

  // Marquee selection box
  if (marqueeBox) {
    const mb = normalizeRect(marqueeBox.x, marqueeBox.y, marqueeBox.width, marqueeBox.height);
    ctx.save();
    ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1.2 / viewport.zoom;
    ctx.fillRect(mb.x, mb.y, mb.width, mb.height);
    ctx.strokeRect(mb.x, mb.y, mb.width, mb.height);
    ctx.restore();
  }

  ctx.restore();
}
