import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyResize,
  findNearestAnchor,
  fitElementsToViewport,
  getElementsInSelectionBox,
  hitTestElement,
  resolveArrowEndpoints,
  screenToWorld,
  simplifyFreehandPoints,
  worldToScreen,
  zoomAtPoint,
} from './geometry';
import type { BoardElement, Viewport } from '../types/board';

function makeRect(overrides: Partial<BoardElement> = {}): BoardElement {
  return {
    id: 'rect-1',
    type: 'rectangle',
    x: 100,
    y: 200,
    width: 160,
    height: 80,
    seed: 42,
    zIndex: 1,
    text: 'Node',
    strokeColor: '#1e293b',
    fillColor: '#ffffff',
    fillStyle: 'hachure',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 'rough',
    opacity: 1,
    fontSize: 16,
    updatedAt: 1,
    ...overrides,
  };
}

test('screenToWorld and worldToScreen are exact inverses across pan and zoom', () => {
  const viewport: Viewport = { x: -145.5, y: 312.25, zoom: 1.75 };
  const worldPt = { x: 420.8, y: -96.4 };
  const screenPt = worldToScreen(worldPt, viewport);
  const back = screenToWorld(screenPt, viewport);

  assert.ok(Math.abs(back.x - worldPt.x) < 1e-9);
  assert.ok(Math.abs(back.y - worldPt.y) < 1e-9);
});

test('zoomAtPoint preserves the exact world coordinate under the cursor', () => {
  const initial: Viewport = { x: 120, y: 80, zoom: 1.0 };
  const cursor = { x: 640, y: 360 };
  const worldBefore = screenToWorld(cursor, initial);

  const zoomed = zoomAtPoint(initial, cursor, 2.2);
  const worldAfter = screenToWorld(cursor, zoomed);

  assert.equal(zoomed.zoom, 2.2);
  assert.ok(Math.abs(worldAfter.x - worldBefore.x) < 1e-9);
  assert.ok(Math.abs(worldAfter.y - worldBefore.y) < 1e-9);
});

test('hitTestElement distinguishes rectangle, diamond, ellipse, and freedraw strokes', () => {
  const rect = makeRect({ id: 'r1', type: 'rectangle', x: 0, y: 0, width: 100, height: 100 });
  const diamond = makeRect({ id: 'd1', type: 'diamond', x: 0, y: 0, width: 100, height: 100 });
  const ellipse = makeRect({ id: 'e1', type: 'ellipse', x: 0, y: 0, width: 100, height: 100 });
  const freedraw = makeRect({
    id: 'f1',
    type: 'freedraw',
    x: 10,
    y: 10,
    width: 100,
    height: 100,
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
  });

  const map = new Map([
    [rect.id, rect],
    [diamond.id, diamond],
    [ellipse.id, ellipse],
    [freedraw.id, freedraw],
  ]);

  // Top-left corner (2, 2) hits rectangle, but misses diamond & ellipse interior
  assert.equal(hitTestElement(rect, { x: 2, y: 2 }, map, 0), true);
  assert.equal(hitTestElement(diamond, { x: 2, y: 2 }, map, 0), false);
  assert.equal(hitTestElement(ellipse, { x: 2, y: 2 }, map, 0), false);

  // Center (50, 50) hits all closed shapes
  assert.equal(hitTestElement(diamond, { x: 50, y: 50 }, map, 0), true);
  assert.equal(hitTestElement(ellipse, { x: 50, y: 50 }, map, 0), true);

  // Freedraw hits near line y=10, misses far away
  assert.equal(hitTestElement(freedraw, { x: 60, y: 12 }, map, 6), true);
  assert.equal(hitTestElement(freedraw, { x: 60, y: 50 }, map, 6), false);
});

test('resolveArrowEndpoints dynamically tracks bound flowchart nodes when moved', () => {
  const nodeA = makeRect({ id: 'a', x: 0, y: 0, width: 100, height: 60 });
  const nodeB = makeRect({ id: 'b', x: 300, y: 100, width: 120, height: 80 });
  const arrow = makeRect({
    id: 'arr-1',
    type: 'arrow',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ],
    startBinding: { elementId: 'a', side: 'right' },
    endBinding: { elementId: 'b', side: 'left' },
  });

  const byId = new Map([
    ['a', nodeA],
    ['b', nodeB],
    ['arr-1', arrow],
  ]);
  const ep1 = resolveArrowEndpoints(arrow, byId);
  assert.deepEqual(ep1.start, { x: 100, y: 30 });
  assert.deepEqual(ep1.end, { x: 300, y: 140 });

  // Move nodeB and verify arrow follows automatically
  byId.set('b', { ...nodeB, x: 450, y: 200 });
  const ep2 = resolveArrowEndpoints(arrow, byId);
  assert.deepEqual(ep2.end, { x: 450, y: 240 });
});

test('findNearestAnchor snaps to the closest port within radius', () => {
  const node = makeRect({ id: 'n1', x: 100, y: 100, width: 100, height: 100 });
  const hit = findNearestAnchor([node], { x: 205, y: 148 }, 20);
  assert.ok(hit);
  assert.equal(hit.elementId, 'n1');
  assert.equal(hit.side, 'right');

  const miss = findNearestAnchor([node], { x: 260, y: 150 }, 20);
  assert.equal(miss, null);
});

test('applyResize respects minSize and updates origin on north/west handles', () => {
  const resized = applyResize({ x: 100, y: 100, width: 100, height: 100 }, 'nw', 90, 90, 30);
  assert.equal(resized.width, 30);
  assert.equal(resized.height, 30);
  assert.equal(resized.x, 170);
  assert.equal(resized.y, 170);
});

test('getElementsInSelectionBox and fitElementsToViewport compute accurate bounds', () => {
  const a = makeRect({ id: 'a', x: 0, y: 0, width: 100, height: 100 });
  const b = makeRect({ id: 'b', x: 400, y: 300, width: 100, height: 100 });

  const inside = getElementsInSelectionBox([a, b], { x: -10, y: -10, width: 150, height: 150 });
  assert.deepEqual(
    inside.map((e) => e.id),
    ['a'],
  );

  const vp = fitElementsToViewport([a, b], 1200, 800);
  assert.ok(vp.zoom > 0 && vp.zoom <= 1.15);
  const screenCenter = worldToScreen({ x: 250, y: 200 }, vp);
  assert.ok(Math.abs(screenCenter.x - 600) < 1e-6);
  assert.ok(Math.abs(screenCenter.y - 400) < 1e-6);
});

test('simplifyFreehandPoints thins redundant close points while keeping endpoints', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.5 },
    { x: 1, y: 1 },
    { x: 10, y: 0 },
    { x: 10.5, y: 0.2 },
    { x: 20, y: 0 },
  ];
  const simplified = simplifyFreehandPoints(pts, 4);
  assert.equal(simplified.length, 3);
  assert.deepEqual(simplified[0], { x: 0, y: 0 });
  assert.deepEqual(simplified[simplified.length - 1], { x: 20, y: 0 });
});
