import type {
  AnchorSide,
  BoardElement,
  Point,
  ResizeHandle,
  Viewport,
} from '../types/board';

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 4.0;
export const GRID_SIZE = 24;

export interface RectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Converts screen-space CSS pixel coordinates (relative to canvas top-left)
 * into infinite world-space coordinates.
 */
export function screenToWorld(screen: Point, viewport: Viewport): Point {
  return {
    x: (screen.x - viewport.x) / viewport.zoom,
    y: (screen.y - viewport.y) / viewport.zoom,
  };
}

/**
 * Converts infinite world-space coordinates into screen-space CSS pixels.
 */
export function worldToScreen(world: Point, viewport: Viewport): Point {
  return {
    x: world.x * viewport.zoom + viewport.x,
    y: world.y * viewport.zoom + viewport.y,
  };
}

/**
 * Zooms the viewport around a fixed screen anchor point (e.g., cursor position)
 * so the world point under the anchor stays visually stationary.
 */
export function zoomAtPoint(
  viewport: Viewport,
  screenAnchor: Point,
  nextZoomRaw: number,
  minZoom = MIN_ZOOM,
  maxZoom = MAX_ZOOM,
): Viewport {
  const nextZoom = Math.min(maxZoom, Math.max(minZoom, nextZoomRaw));
  const worldBefore = screenToWorld(screenAnchor, viewport);
  return {
    x: screenAnchor.x - worldBefore.x * nextZoom,
    y: screenAnchor.y - worldBefore.y * nextZoom,
    zoom: nextZoom,
  };
}

/**
 * Computes a viewport that frames all given elements nicely within the canvas container.
 */
export function fitElementsToViewport(
  elements: BoardElement[],
  canvasWidth: number,
  canvasHeight: number,
  padding = 96,
): Viewport {
  if (elements.length === 0 || canvasWidth <= 0 || canvasHeight <= 0) {
    return { x: canvasWidth / 2, y: canvasHeight / 2, zoom: 1 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const mapById = new Map(elements.map((e) => [e.id, e]));
  for (const el of elements) {
    const b = getElementBounds(el, mapById);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }

  const contentW = Math.max(maxX - minX, 1);
  const contentH = Math.max(maxY - minY, 1);
  const availW = Math.max(canvasWidth - padding * 2, 120);
  const availH = Math.max(canvasHeight - padding * 2, 120);

  const zoom = Math.min(1.15, Math.max(MIN_ZOOM, Math.min(availW / contentW, availH / contentH)));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return {
    x: canvasWidth / 2 - centerX * zoom,
    y: canvasHeight / 2 - centerY * zoom,
    zoom,
  };
}

export function isConnectableElement(el: BoardElement): boolean {
  return (
    el.type === 'rectangle' ||
    el.type === 'diamond' ||
    el.type === 'ellipse' ||
    el.type === 'sticky'
  );
}

/**
 * Returns the 4 anchor connection ports on a shape node in world coordinates.
 */
export function getElementAnchors(el: BoardElement): Record<AnchorSide, Point> {
  return {
    top: { x: el.x + el.width / 2, y: el.y },
    right: { x: el.x + el.width, y: el.y + el.height / 2 },
    bottom: { x: el.x + el.width / 2, y: el.y + el.height },
    left: { x: el.x, y: el.y + el.height / 2 },
  };
}

/**
 * Resolves the world-space start and end points of an arrow element,
 * dynamically following any bound source/target flowchart nodes.
 */
export function resolveArrowEndpoints(
  arrow: BoardElement,
  elementsById: Map<string, BoardElement>,
): { start: Point; end: Point } {
  const localStart = arrow.points?.[0] ?? { x: 0, y: 0 };
  const localEnd = arrow.points?.[1] ?? { x: arrow.width, y: arrow.height };

  let start: Point = { x: arrow.x + localStart.x, y: arrow.y + localStart.y };
  let end: Point = { x: arrow.x + localEnd.x, y: arrow.y + localEnd.y };

  if (arrow.startBinding) {
    const target = elementsById.get(arrow.startBinding.elementId);
    if (target) {
      start = getElementAnchors(target)[arrow.startBinding.side];
    }
  }
  if (arrow.endBinding) {
    const target = elementsById.get(arrow.endBinding.elementId);
    if (target) {
      end = getElementAnchors(target)[arrow.endBinding.side];
    }
  }

  return { start, end };
}

/**
 * Computes a clean cubic Bezier control point pair for bound flowchart connectors
 * so arrows leave and enter anchor ports orthogonally without overlapping shapes.
 */
export function getArrowCurveControlPoints(
  start: Point,
  end: Point,
  startSide?: AnchorSide | null,
  endSide?: AnchorSide | null,
): { cp1: Point; cp2: Point; isCurved: boolean } {
  if (!startSide && !endSide) {
    return {
      cp1: { x: start.x + (end.x - start.x) / 3, y: start.y + (end.y - start.y) / 3 },
      cp2: { x: start.x + ((end.x - start.x) * 2) / 3, y: start.y + ((end.y - start.y) * 2) / 3 },
      isCurved: false,
    };
  }

  const dist = Math.hypot(end.x - start.x, end.y - start.y);
  const offset = Math.max(36, Math.min(130, dist * 0.42));

  const sideVector = (side?: AnchorSide | null): Point => {
    switch (side) {
      case 'top':
        return { x: 0, y: -1 };
      case 'right':
        return { x: 1, y: 0 };
      case 'bottom':
        return { x: 0, y: 1 };
      case 'left':
        return { x: -1, y: 0 };
      default:
        return { x: 0, y: 0 };
    }
  };

  const sv = sideVector(startSide);
  const ev = sideVector(endSide);

  const cp1 = startSide
    ? { x: start.x + sv.x * offset, y: start.y + sv.y * offset }
    : { x: start.x + (end.x - start.x) * 0.35, y: start.y + (end.y - start.y) * 0.35 };

  const cp2 = endSide
    ? { x: end.x + ev.x * offset, y: end.y + ev.y * offset }
    : { x: end.x - (end.x - start.x) * 0.35, y: end.y - (end.y - start.y) * 0.35 };

  return { cp1, cp2, isCurved: true };
}

/**
 * Evaluates a point along a cubic Bezier curve for parameter t in [0, 1].
 */
export function cubicBezierPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;

  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

/**
 * Samples a polyline approximation of a cubic Bezier curve for RoughJS rendering & hit testing.
 */
export function sampleCubicBezier(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  segments = 24,
): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    pts.push(cubicBezierPoint(p0, p1, p2, p3, i / segments));
  }
  return pts;
}

export function getElementBounds(
  el: BoardElement,
  elementsById?: Map<string, BoardElement>,
): RectBounds {
  if (el.type === 'arrow') {
    const { start, end } = resolveArrowEndpoints(el, elementsById ?? new Map());
    const minX = Math.min(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxX = Math.max(start.x, end.x);
    const maxY = Math.max(start.y, end.y);
    return {
      x: minX,
      y: minY,
      width: Math.max(maxX - minX, 8),
      height: Math.max(maxY - minY, 8),
    };
  }

  return {
    x: el.width < 0 ? el.x + el.width : el.x,
    y: el.height < 0 ? el.y + el.height : el.y,
    width: Math.abs(el.width),
    height: Math.abs(el.height),
  };
}

export function normalizeRect(x: number, y: number, width: number, height: number): RectBounds {
  return {
    x: width < 0 ? x + width : x,
    y: height < 0 ? y + height : y,
    width: Math.abs(width),
    height: Math.abs(height),
  };
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

/**
 * Tests whether a world-space point hits a given element.
 */
export function hitTestElement(
  el: BoardElement,
  point: Point,
  elementsById: Map<string, BoardElement>,
  tolerance = 8,
): boolean {
  if (el.type === 'arrow') {
    const { start, end } = resolveArrowEndpoints(el, elementsById);
    const { cp1, cp2, isCurved } = getArrowCurveControlPoints(
      start,
      end,
      el.startBinding?.side,
      el.endBinding?.side,
    );
    if (!isCurved) {
      return distanceToSegment(point, start, end) <= tolerance + el.strokeWidth;
    }
    const pts = sampleCubicBezier(start, cp1, cp2, end, 20);
    for (let i = 0; i < pts.length - 1; i++) {
      if (distanceToSegment(point, pts[i], pts[i + 1]) <= tolerance + el.strokeWidth) {
        return true;
      }
    }
    return false;
  }

  if (el.type === 'freedraw') {
    const pts = el.points ?? [];
    if (pts.length === 0) return false;
    if (pts.length === 1) {
      return Math.hypot(point.x - (el.x + pts[0].x), point.y - (el.y + pts[0].y)) <= tolerance + el.strokeWidth;
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = { x: el.x + pts[i].x, y: el.y + pts[i].y };
      const b = { x: el.x + pts[i + 1].x, y: el.y + pts[i + 1].y };
      if (distanceToSegment(point, a, b) <= tolerance + el.strokeWidth) {
        return true;
      }
    }
    return false;
  }

  const b = getElementBounds(el, elementsById);
  if (el.type === 'diamond') {
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const rx = Math.max(b.width / 2, 1) + tolerance;
    const ry = Math.max(b.height / 2, 1) + tolerance;
    return Math.abs(point.x - cx) / rx + Math.abs(point.y - cy) / ry <= 1;
  }

  if (el.type === 'ellipse') {
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const rx = Math.max(b.width / 2, 1) + tolerance;
    const ry = Math.max(b.height / 2, 1) + tolerance;
    const nx = (point.x - cx) / rx;
    const ny = (point.y - cy) / ry;
    return nx * nx + ny * ny <= 1;
  }

  return (
    point.x >= b.x - tolerance &&
    point.x <= b.x + b.width + tolerance &&
    point.y >= b.y - tolerance &&
    point.y <= b.y + b.height + tolerance
  );
}

/**
 * Returns the topmost element at the world-space point (highest zIndex first).
 */
export function findTopmostElementAtPoint(
  elements: BoardElement[],
  point: Point,
  tolerance = 8,
): BoardElement | null {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const sorted = [...elements].sort((a, b) => b.zIndex - a.zIndex);
  for (const el of sorted) {
    if (hitTestElement(el, point, byId, tolerance)) {
      return el;
    }
  }
  return null;
}

/**
 * Finds the nearest connectable shape anchor within snapRadius in world coordinates.
 */
export function findNearestAnchor(
  elements: BoardElement[],
  worldPoint: Point,
  snapRadius = 22,
  excludeId?: string,
): { elementId: string; side: AnchorSide; point: Point } | null {
  let best: { elementId: string; side: AnchorSide; point: Point; dist: number } | null = null;
  const sides: AnchorSide[] = ['top', 'right', 'bottom', 'left'];

  for (const el of elements) {
    if (!isConnectableElement(el) || el.id === excludeId) continue;
    const anchors = getElementAnchors(el);
    for (const side of sides) {
      const pt = anchors[side];
      const dist = Math.hypot(worldPoint.x - pt.x, worldPoint.y - pt.y);
      if (dist <= snapRadius && (!best || dist < best.dist)) {
        best = { elementId: el.id, side, point: pt, dist };
      }
    }
  }

  return best ? { elementId: best.elementId, side: best.side, point: best.point } : null;
}

export function getResizeHandlePositions(bounds: RectBounds): Record<ResizeHandle, Point> {
  const { x, y, width, height } = bounds;
  return {
    nw: { x, y },
    n: { x: x + width / 2, y },
    ne: { x: x + width, y },
    e: { x: x + width, y: y + height / 2 },
    se: { x: x + width, y: y + height },
    s: { x: x + width / 2, y: y + height },
    sw: { x, y: y + height },
    w: { x, y: y + height / 2 },
  };
}

export function hitTestResizeHandle(
  bounds: RectBounds,
  worldPoint: Point,
  zoom: number,
): ResizeHandle | null {
  const hitRadius = 9 / zoom;
  const handles = getResizeHandlePositions(bounds);
  const order: ResizeHandle[] = ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w'];
  for (const handle of order) {
    const pt = handles[handle];
    if (Math.hypot(worldPoint.x - pt.x, worldPoint.y - pt.y) <= hitRadius) {
      return handle;
    }
  }
  return null;
}

export function applyResize(
  initial: RectBounds,
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number,
  minSize = 28,
): RectBounds {
  let { x, y, width, height } = initial;

  if (handle.includes('e')) {
    width = Math.max(minSize, initial.width + deltaX);
  }
  if (handle.includes('s')) {
    height = Math.max(minSize, initial.height + deltaY);
  }
  if (handle.includes('w')) {
    const nextWidth = Math.max(minSize, initial.width - deltaX);
    x = initial.x + (initial.width - nextWidth);
    width = nextWidth;
  }
  if (handle.includes('n')) {
    const nextHeight = Math.max(minSize, initial.height - deltaY);
    y = initial.y + (initial.height - nextHeight);
    height = nextHeight;
  }

  return { x, y, width, height };
}

export function rectsIntersect(a: RectBounds, b: RectBounds): boolean {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}

export function getElementsInSelectionBox(
  elements: BoardElement[],
  box: RectBounds,
): BoardElement[] {
  const normBox = normalizeRect(box.x, box.y, box.width, box.height);
  const byId = new Map(elements.map((e) => [e.id, e]));
  return elements.filter((el) => rectsIntersect(getElementBounds(el, byId), normBox));
}

export function snapToGrid(value: number, enabled: boolean, gridSize = GRID_SIZE): number {
  if (!enabled) return value;
  return Math.round(value / gridSize) * gridSize;
}

/**
 * Reduces dense freehand points using distance thinning for crisp rendering and smaller CRDT deltas.
 */
export function simplifyFreehandPoints(points: Point[], minDistance = 3): Point[] {
  if (points.length <= 2) return points;
  const result: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1];
    if (Math.hypot(points[i].x - prev.x, points[i].y - prev.y) >= minDistance) {
      result.push(points[i]);
    }
  }
  result.push(points[points.length - 1]);
  return result;
}
