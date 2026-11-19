import React from 'react';
import {
  Activity,
  Maximize2,
  Minus,
  Plus,
  Redo2,
  Undo2,
} from 'lucide-react';

interface ZoomControlsProps {
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  inspectorOpen: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onFitView: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleInspector: () => void;
}

export const ZoomControls: React.FC<ZoomControlsProps> = ({
  zoom,
  canUndo,
  canRedo,
  inspectorOpen,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onFitView,
  onUndo,
  onRedo,
  onToggleInspector,
}) => {
  const zoomPercent = Math.round(zoom * 100);

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 left-4 z-30 flex items-end justify-between gap-3">
      {/* Bottom-Left: Zoom + Undo/Redo */}
      <div className="pointer-events-auto flex items-center gap-2">
        <div className="flex items-center rounded-xl border border-stone-200/90 bg-white/95 p-1 shadow-sm backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/95">
          <button
            type="button"
            onClick={onZoomOut}
            aria-label="缩小画布"
            title="缩小 (-)"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-700 transition-colors hover:bg-stone-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onZoomReset}
            aria-label={`当前缩放 ${zoomPercent}%，点击重置为 100%`}
            title="重置为 100%"
            data-testid="zoom-percentage"
            className="font-mono-tabular h-8 min-w-[54px] rounded-lg px-2 text-xs font-medium text-stone-800 transition-colors hover:bg-stone-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {zoomPercent}%
          </button>
          <button
            type="button"
            onClick={onZoomIn}
            aria-label="放大画布"
            title="放大 (+)"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-700 transition-colors hover:bg-stone-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <Plus className="h-4 w-4" />
          </button>
          <div aria-hidden="true" className="mx-1 h-4 w-px bg-stone-200 dark:bg-zinc-800" />
          <button
            type="button"
            onClick={onFitView}
            aria-label="适应画布"
            title="适应画布内容 (Shift+1)"
            className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium whitespace-nowrap text-stone-700 transition-colors hover:bg-stone-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">适应</span>
          </button>
        </div>

        <div className="flex items-center rounded-xl border border-stone-200/90 bg-white/95 p-1 shadow-sm backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/95">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="撤销"
            title="撤销 (Ctrl+Z)"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-700 transition-colors hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-35 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            aria-label="重做"
            title="重做 (Ctrl+Shift+Z)"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-700 transition-colors hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-35 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <Redo2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Bottom-Right: Technical CRDT / P2P Inspector Toggle */}
      <div className="pointer-events-auto">
        <button
          type="button"
          onClick={onToggleInspector}
          aria-expanded={inspectorOpen}
          aria-label="打开 CRDT 与 P2P 同步监视器"
          className={`flex h-10 items-center gap-2 rounded-xl border px-3 text-xs font-medium whitespace-nowrap shadow-sm backdrop-blur-md transition-colors ${
            inspectorOpen
              ? 'border-blue-600 bg-blue-600 text-white'
              : 'border-stone-200/90 bg-white/95 text-stone-700 hover:bg-stone-100 dark:border-zinc-800 dark:bg-zinc-900/95 dark:text-zinc-300 dark:hover:bg-zinc-800'
          }`}
        >
          <Activity className="h-3.5 w-3.5" />
          <span>CRDT 监视器</span>
        </button>
      </div>
    </div>
  );
};
