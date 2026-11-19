import React from 'react';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  Trash2,
} from 'lucide-react';
import type { ElementStyle, FillStyle, RoughnessStyle, StrokeStyle } from '../types/board';
import { FILL_COLORS, STROKE_COLORS } from '../core/templates';

interface StyleInspectorProps {
  style: ElementStyle;
  hasSelection: boolean;
  selectionCount: number;
  onChangeStyle: (patch: Partial<ElementStyle>) => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export const StyleInspector: React.FC<StyleInspectorProps> = ({
  style,
  hasSelection,
  selectionCount,
  onChangeStyle,
  onBringToFront,
  onSendToBack,
  onDuplicate,
  onDelete,
}) => {
  return (
    <aside
      aria-label="图形样式属性面板"
      className="pointer-events-auto flex w-56 flex-col gap-3.5 rounded-xl border border-stone-200/90 bg-white/95 p-3.5 shadow-sm backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/95"
    >
      {/* Stroke Color */}
      <div>
        <div className="mb-1.5 text-xs font-medium text-stone-600 dark:text-zinc-400">
          描边颜色
        </div>
        <div className="flex items-center gap-1.5">
          {STROKE_COLORS.map((swatch) => {
            const active = style.strokeColor.toLowerCase() === swatch.value.toLowerCase();
            return (
              <button
                key={swatch.value}
                type="button"
                aria-label={`描边色：${swatch.name}`}
                aria-pressed={active}
                title={swatch.name}
                onClick={() => onChangeStyle({ strokeColor: swatch.value })}
                style={{ backgroundColor: swatch.value }}
                className={`h-6 w-6 rounded-md border transition-transform focus-visible:outline-2 focus-visible:outline-blue-600 ${
                  active
                    ? 'scale-110 border-blue-600 ring-2 ring-blue-600/30'
                    : 'border-black/10 hover:scale-105 dark:border-white/15'
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* Fill Color */}
      <div>
        <div className="mb-1.5 text-xs font-medium text-stone-600 dark:text-zinc-400">
          填充背景
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {FILL_COLORS.map((swatch) => {
            const active = style.fillColor.toLowerCase() === swatch.value.toLowerCase();
            const isTransparent = swatch.value === 'transparent';
            return (
              <button
                key={swatch.value}
                type="button"
                aria-label={`填充色：${swatch.name}`}
                aria-pressed={active}
                title={swatch.name}
                onClick={() => onChangeStyle({ fillColor: swatch.value })}
                style={isTransparent ? undefined : { backgroundColor: swatch.value }}
                className={`relative h-6 w-6 rounded-md border transition-transform focus-visible:outline-2 focus-visible:outline-blue-600 ${
                  isTransparent
                    ? 'bg-stone-50 dark:bg-zinc-800'
                    : ''
                } ${
                  active
                    ? 'scale-110 border-blue-600 ring-2 ring-blue-600/30'
                    : 'border-stone-300 hover:scale-105 dark:border-zinc-700'
                }`}
              >
                {isTransparent && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0.5 top-1/2 h-px -rotate-45 bg-red-500"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Fill Style */}
      <div>
        <div className="mb-1.5 text-xs font-medium text-stone-600 dark:text-zinc-400">
          填充纹理
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-stone-100 p-1 dark:bg-zinc-800">
          {(
            [
              { id: 'hachure', label: '斜线' },
              { id: 'solid', label: '纯色' },
              { id: 'cross-hatch', label: '网格' },
            ] as Array<{ id: FillStyle; label: string }>
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onChangeStyle({ fillStyle: item.id })}
              className={`rounded-md py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                style.fillStyle === item.id
                  ? 'bg-white text-stone-950 shadow-xs dark:bg-zinc-700 dark:text-zinc-50'
                  : 'text-stone-600 hover:text-stone-900 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stroke Width + Style */}
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <div className="mb-1.5 text-xs font-medium text-stone-600 dark:text-zinc-400">
            线宽
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-stone-100 p-1 dark:bg-zinc-800">
            {[
              { val: 1.5, label: '细' },
              { val: 2, label: '中' },
              { val: 3.5, label: '粗' },
            ].map((w) => (
              <button
                key={w.val}
                type="button"
                onClick={() => onChangeStyle({ strokeWidth: w.val })}
                className={`rounded-md py-1 text-xs font-medium transition-colors ${
                  style.strokeWidth === w.val
                    ? 'bg-white text-stone-950 shadow-xs dark:bg-zinc-700 dark:text-zinc-50'
                    : 'text-stone-600 hover:text-stone-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium text-stone-600 dark:text-zinc-400">
            线型
          </div>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-stone-100 p-1 dark:bg-zinc-800">
            {(
              [
                { id: 'solid', label: '实线' },
                { id: 'dashed', label: '虚线' },
              ] as Array<{ id: StrokeStyle; label: string }>
            ).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onChangeStyle({ strokeStyle: s.id })}
                className={`rounded-md py-1 text-xs font-medium transition-colors ${
                  style.strokeStyle === s.id
                    ? 'bg-white text-stone-950 shadow-xs dark:bg-zinc-700 dark:text-zinc-50'
                    : 'text-stone-600 hover:text-stone-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Roughness */}
      <div>
        <div className="mb-1.5 text-xs font-medium text-stone-600 dark:text-zinc-400">
          线条风格
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-stone-100 p-1 dark:bg-zinc-800">
          {(
            [
              { id: 'rough', label: '手绘草图' },
              { id: 'clean', label: '精准几何' },
            ] as Array<{ id: RoughnessStyle; label: string }>
          ).map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onChangeStyle({ roughness: r.id })}
              className={`rounded-md py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                style.roughness === r.id
                  ? 'bg-white text-stone-950 shadow-xs dark:bg-zinc-700 dark:text-zinc-50'
                  : 'text-stone-600 hover:text-stone-900 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Selection Actions */}
      {hasSelection && (
        <div className="border-t border-stone-200 pt-3 dark:border-zinc-800">
          <div className="mb-2 flex items-center justify-between text-xs text-stone-500 dark:text-zinc-400">
            <span>图层与操作</span>
            <span className="font-mono-tabular">已选 {selectionCount} 项</span>
          </div>
          <div className="grid grid-cols-4 gap-1">
            <button
              type="button"
              onClick={onBringToFront}
              aria-label="置于顶层"
              title="置于顶层"
              className="flex h-9 items-center justify-center rounded-lg border border-stone-200 text-stone-700 transition-colors hover:bg-stone-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <ArrowUpToLine className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onSendToBack}
              aria-label="置于底层"
              title="置于底层"
              className="flex h-9 items-center justify-center rounded-lg border border-stone-200 text-stone-700 transition-colors hover:bg-stone-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <ArrowDownToLine className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onDuplicate}
              aria-label="复制选中图形"
              title="复制 (Ctrl+D)"
              className="flex h-9 items-center justify-center rounded-lg border border-stone-200 text-stone-700 transition-colors hover:bg-stone-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <Copy className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              aria-label="删除选中图形"
              title="删除 (Delete)"
              className="flex h-9 items-center justify-center rounded-lg border border-red-200 text-red-600 transition-colors hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </aside>
  );
};
