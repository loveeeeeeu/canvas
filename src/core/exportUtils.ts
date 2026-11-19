import type { BoardElement, ThemeMode } from '../types/board';
import {
  getArrowCurveControlPoints,
  getElementBounds,
  normalizeRect,
  resolveArrowEndpoints,
} from './geometry';
import { renderScene } from '../canvas/roughRenderer';

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function computeSceneBoundingBox(elements: BoardElement[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (elements.length === 0) {
    return { x: 0, y: 0, width: 960, height: 600 };
  }
  const byId = new Map(elements.map((e) => [e.id, e]));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of elements) {
    const b = getElementBounds(el, byId);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  const pad = 48;
  return {
    x: minX - pad,
    y: minY - pad,
    width: Math.max(maxX - minX + pad * 2, 240),
    height: Math.max(maxY - minY + pad * 2, 180),
  };
}

export function exportBoardAsPNG(elements: BoardElement[], theme: ThemeMode, roomId: string): void {
  const box = computeSceneBoundingBox(elements);
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(box.width * scale);
  canvas.height = Math.round(box.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.scale(scale, scale);
  renderScene({
    ctx,
    canvas,
    width: box.width,
    height: box.height,
    viewport: { x: -box.x, y: -box.y, zoom: 1 },
    elements,
    draftElement: null,
    selectedIds: [],
    remoteSelections: [],
    marqueeBox: null,
    hoveredAnchor: null,
    showAnchorPorts: false,
    editingElementId: null,
    showGrid: false,
    theme,
  });

  canvas.toBlob((blob) => {
    if (blob) {
      triggerDownload(blob, `inkflow-${roomId}.png`);
    }
  }, 'image/png');
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function exportBoardAsSVG(elements: BoardElement[], theme: ThemeMode, roomId: string): void {
  const box = computeSceneBoundingBox(elements);
  const byId = new Map(elements.map((e) => [e.id, e]));
  const bg = theme === 'dark' ? '#14161a' : '#faf9f6';

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.x} ${box.y} ${box.width} ${box.height}" width="${box.width}" height="${box.height}">`,
    `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="${bg}" />`,
    `<defs><marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="context-stroke" /></marker></defs>`,
  ];

  for (const el of elements) {
    const stroke = theme === 'dark' && el.strokeColor === '#1e293b' ? '#e2e8f0' : el.strokeColor;
    const fill = el.fillColor === 'transparent' ? 'none' : el.fillColor;
    const dash = el.strokeStyle === 'dashed' ? ' stroke-dasharray="8 6"' : '';

    if (el.type === 'rectangle' || el.type === 'sticky') {
      const b = normalizeRect(el.x, el.y, el.width, el.height);
      parts.push(
        `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="${el.strokeWidth}"${dash} />`,
      );
      if (el.text) {
        parts.push(
          `<text x="${b.x + b.width / 2}" y="${b.y + b.height / 2}" fill="${stroke}" font-size="${el.fontSize}" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">${escapeXml(el.text)}</text>`,
        );
      }
    } else if (el.type === 'ellipse') {
      const b = normalizeRect(el.x, el.y, el.width, el.height);
      parts.push(
        `<ellipse cx="${b.x + b.width / 2}" cy="${b.y + b.height / 2}" rx="${b.width / 2}" ry="${b.height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${el.strokeWidth}"${dash} />`,
      );
      if (el.text) {
        parts.push(
          `<text x="${b.x + b.width / 2}" y="${b.y + b.height / 2}" fill="${stroke}" font-size="${el.fontSize}" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">${escapeXml(el.text)}</text>`,
        );
      }
    } else if (el.type === 'diamond') {
      const b = normalizeRect(el.x, el.y, el.width, el.height);
      const pts = `${b.x + b.width / 2},${b.y} ${b.x + b.width},${b.y + b.height / 2} ${b.x + b.width / 2},${b.y + b.height} ${b.x},${b.y + b.height / 2}`;
      parts.push(
        `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="${el.strokeWidth}"${dash} />`,
      );
      if (el.text) {
        parts.push(
          `<text x="${b.x + b.width / 2}" y="${b.y + b.height / 2}" fill="${stroke}" font-size="${el.fontSize}" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">${escapeXml(el.text)}</text>`,
        );
      }
    } else if (el.type === 'arrow') {
      const { start, end } = resolveArrowEndpoints(el, byId);
      const { cp1, cp2, isCurved } = getArrowCurveControlPoints(
        start,
        end,
        el.startBinding?.side,
        el.endBinding?.side,
      );
      const d = isCurved
        ? `M ${start.x} ${start.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${end.x} ${end.y}`
        : `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
      parts.push(
        `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${el.strokeWidth}" marker-end="url(#arrowhead)"${dash} />`,
      );
    } else if (el.type === 'freedraw' && el.points && el.points.length > 1) {
      const d = el.points
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${el.x + p.x} ${el.y + p.y}`)
        .join(' ');
      parts.push(
        `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${el.strokeWidth}" stroke-linecap="round" stroke-linejoin="round" />`,
      );
    } else if (el.type === 'text' && el.text) {
      parts.push(
        `<text x="${el.x}" y="${el.y + el.fontSize}" fill="${stroke}" font-size="${el.fontSize}" font-family="sans-serif">${escapeXml(el.text)}</text>`,
      );
    }
  }

  parts.push('</svg>');
  const blob = new Blob([parts.join('\n')], { type: 'image/svg+xml;charset=utf-8' });
  triggerDownload(blob, `inkflow-${roomId}.svg`);
}

export function exportBoardAsJSON(elements: BoardElement[], roomId: string): void {
  const payload = {
    app: 'InkFlow P2P',
    version: 1,
    exportedAt: new Date().toISOString(),
    roomId,
    elements,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  triggerDownload(blob, `inkflow-${roomId}.json`);
}

export function parseImportedBoardJSON(raw: string): BoardElement[] {
  const data = JSON.parse(raw) as { elements?: unknown };
  if (!data || !Array.isArray(data.elements)) {
    throw new Error('JSON 文件缺少有效的 elements 数组');
  }
  const validTypes = new Set([
    'rectangle',
    'diamond',
    'ellipse',
    'arrow',
    'freedraw',
    'text',
    'sticky',
  ]);
  return data.elements.filter((item): item is BoardElement => {
    if (!item || typeof item !== 'object') return false;
    const candidate = item as Partial<BoardElement>;
    return (
      typeof candidate.id === 'string' &&
      typeof candidate.type === 'string' &&
      validTypes.has(candidate.type) &&
      typeof candidate.x === 'number' &&
      typeof candidate.y === 'number'
    );
  });
}
