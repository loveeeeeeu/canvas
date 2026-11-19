import React from 'react';
import {
  ArrowUpRight,
  Circle,
  Diamond,
  Eraser,
  Hand,
  MousePointer2,
  Pencil,
  Square,
  StickyNote,
  Type,
} from 'lucide-react';
import type { ToolType } from '../types/board';

interface ToolItem {
  id: ToolType;
  label: string;
  shortcut: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TOOLS: ToolItem[] = [
  { id: 'select', label: '选择与移动', shortcut: 'V', icon: MousePointer2 },
  { id: 'hand', label: '平移画布', shortcut: 'H', icon: Hand },
  { id: 'rectangle', label: '矩形节点', shortcut: 'R', icon: Square },
  { id: 'diamond', label: '菱形判断', shortcut: 'D', icon: Diamond },
  { id: 'ellipse', label: '椭圆起止', shortcut: 'O', icon: Circle },
  { id: 'arrow', label: '流程连线', shortcut: 'A', icon: ArrowUpRight },
  { id: 'freedraw', label: '手绘铅笔', shortcut: 'P', icon: Pencil },
  { id: 'text', label: '插入文本', shortcut: 'T', icon: Type },
  { id: 'sticky', label: '便利贴', shortcut: 'S', icon: StickyNote },
  { id: 'eraser', label: '橡皮擦', shortcut: 'E', icon: Eraser },
];

interface ToolbarProps {
  activeTool: ToolType;
  onSelectTool: (tool: ToolType) => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({ activeTool, onSelectTool }) => {
  return (
    <div
      role="toolbar"
      aria-label="绘图工具栏"
      className="pointer-events-auto flex items-center gap-0.5 rounded-xl border border-stone-200/90 bg-white/95 p-1 shadow-sm backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/95"
    >
      {TOOLS.map((tool, index) => {
        const Icon = tool.icon;
        const isActive = activeTool === tool.id;
        return (
          <React.Fragment key={tool.id}>
            {(index === 2 || index === 9) && (
              <div
                aria-hidden="true"
                className="mx-1 h-5 w-px bg-stone-200 dark:bg-zinc-800"
              />
            )}
            <button
              type="button"
              onClick={() => onSelectTool(tool.id)}
              aria-label={`${tool.label} (${tool.shortcut})`}
              aria-pressed={isActive}
              title={`${tool.label} (${tool.shortcut})`}
              className={`group relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-stone-700 hover:bg-stone-100 hover:text-stone-950 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50'
              }`}
            >
              <Icon className="h-[18px] w-[18px]" />
              <span
                aria-hidden="true"
                className={`font-mono-tabular pointer-events-none absolute right-1 bottom-0.5 text-[9px] leading-none ${
                  isActive
                    ? 'text-blue-100'
                    : 'text-stone-400 group-hover:text-stone-600 dark:text-zinc-500 dark:group-hover:text-zinc-300'
                }`}
              >
                {tool.shortcut}
              </span>
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
};
