import React, { useEffect, useRef, useState } from 'react';
import {
  Download,
  FileCode2,
  FileJson,
  Grid3X3,
  Image as ImageIcon,
  LayoutTemplate,
  Menu,
  Moon,
  Share2,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react';
import type { PeerAwarenessState, ThemeMode } from '../types/board';
import { BOARD_TEMPLATES } from '../core/templates';

interface TopBarProps {
  roomId: string;
  peers: PeerAwarenessState[];
  theme: ThemeMode;
  showGrid: boolean;
  onToggleTheme: () => void;
  onToggleGrid: () => void;
  onLoadTemplate: (templateId: string) => void;
  onExportPNG: () => void;
  onExportSVG: () => void;
  onExportJSON: () => void;
  onImportJSON: (file: File) => void;
  onClearBoard: () => void;
  onOpenCollab: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  roomId,
  peers,
  theme,
  showGrid,
  onToggleTheme,
  onToggleGrid,
  onLoadTemplate,
  onExportPNG,
  onExportSVG,
  onExportJSON,
  onImportJSON,
  onClearBoard,
  onOpenCollab,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setConfirmClear(false);
      }
    };
    window.addEventListener('mousedown', handleOutside);
    return () => window.removeEventListener('mousedown', handleOutside);
  }, [menuOpen]);

  return (
    <>
      {/* Top-Left Brand + Canvas Menu Island */}
      <div
        ref={menuRef}
        className="pointer-events-auto relative flex items-center gap-2 rounded-xl border border-stone-200/90 bg-white/95 px-2.5 py-1.5 shadow-sm backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/95"
      >
        <button
          type="button"
          onClick={() => {
            setMenuOpen((prev) => !prev);
            setConfirmClear(false);
          }}
          aria-label="打开画布菜单"
          aria-expanded={menuOpen}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-stone-700 transition-colors hover:bg-stone-100 hover:text-stone-950 focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
        >
          <Menu className="h-[18px] w-[18px]" />
        </button>

        <span className="pr-1.5 text-sm font-semibold tracking-tight whitespace-nowrap text-stone-900 select-none dark:text-zinc-100">
          墨流白板
        </span>

        {menuOpen && (
          <div
            role="menu"
            aria-label="画布操作菜单"
            className="absolute top-13 left-0 z-50 w-64 rounded-xl border border-stone-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="px-2.5 py-1.5 text-xs font-medium text-stone-500 dark:text-zinc-400">
              场景模板
            </div>
            {BOARD_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  onLoadTemplate(tpl.id);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-stone-800 transition-colors hover:bg-stone-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <LayoutTemplate className="h-4 w-4 shrink-0 text-stone-500 dark:text-zinc-400" />
                <span className="truncate">{tpl.name}</span>
              </button>
            ))}

            <div className="my-1.5 h-px bg-stone-200 dark:bg-zinc-800" />

            <div className="px-2.5 py-1.5 text-xs font-medium text-stone-500 dark:text-zinc-400">
              导入与导出
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onExportPNG();
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-stone-800 transition-colors hover:bg-stone-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <ImageIcon className="h-4 w-4 shrink-0 text-stone-500 dark:text-zinc-400" />
              <span>导出高清 PNG</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onExportSVG();
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-stone-800 transition-colors hover:bg-stone-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <FileCode2 className="h-4 w-4 shrink-0 text-stone-500 dark:text-zinc-400" />
              <span>导出矢量 SVG</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onExportJSON();
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-stone-800 transition-colors hover:bg-stone-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <Download className="h-4 w-4 shrink-0 text-stone-500 dark:text-zinc-400" />
              <span>导出场景 JSON</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-stone-800 transition-colors hover:bg-stone-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <Upload className="h-4 w-4 shrink-0 text-stone-500 dark:text-zinc-400" />
              <span>导入场景 JSON</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  onImportJSON(file);
                  setMenuOpen(false);
                }
                e.target.value = '';
              }}
            />

            <div className="my-1.5 h-px bg-stone-200 dark:bg-zinc-800" />

            <div className="px-2.5 py-1.5 text-xs font-medium text-stone-500 dark:text-zinc-400">
              画布偏好
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={onToggleGrid}
              className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm text-stone-800 transition-colors hover:bg-stone-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <span className="flex items-center gap-2.5">
                <Grid3X3 className="h-4 w-4 shrink-0 text-stone-500 dark:text-zinc-400" />
                <span>点阵网格</span>
              </span>
              <span className="text-xs text-stone-500 dark:text-zinc-400">
                {showGrid ? '开启' : '关闭'}
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={onToggleTheme}
              className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm text-stone-800 transition-colors hover:bg-stone-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <span className="flex items-center gap-2.5">
                {theme === 'dark' ? (
                  <Sun className="h-4 w-4 shrink-0 text-stone-500 dark:text-zinc-400" />
                ) : (
                  <Moon className="h-4 w-4 shrink-0 text-stone-500 dark:text-zinc-400" />
                )}
                <span>深浅主题</span>
              </span>
              <span className="text-xs text-stone-500 dark:text-zinc-400">
                {theme === 'dark' ? '深色' : '浅色'}
              </span>
            </button>

            <div className="my-1.5 h-px bg-stone-200 dark:bg-zinc-800" />

            {!confirmClear ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => setConfirmClear(true)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                <Trash2 className="h-4 w-4 shrink-0" />
                <span>清空当前画布</span>
              </button>
            ) : (
              <div className="flex items-center justify-between gap-2 rounded-lg bg-red-50 px-2.5 py-2 dark:bg-red-950/40">
                <span className="text-xs font-medium text-red-700 dark:text-red-300">确认清空？</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="rounded px-2 py-1 text-xs text-stone-600 hover:bg-white dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClearBoard();
                      setConfirmClear(false);
                      setMenuOpen(false);
                    }}
                    className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                  >
                    清空
                  </button>
                </div>
              </div>
            )}

            <div className="mt-1.5 flex items-center justify-between border-t border-stone-100 px-2.5 pt-2 text-[11px] text-stone-500 dark:border-zinc-800 dark:text-zinc-400">
              <span className="flex items-center gap-1">
                <FileJson className="h-3.5 w-3.5" />
                房间号
              </span>
              <span className="font-mono-tabular">{roomId}</span>
            </div>
          </div>
        )}
      </div>

      {/* Top-Right Collaborators + Primary P2P Action */}
      <div className="pointer-events-auto flex items-center gap-2.5 rounded-xl border border-stone-200/90 bg-white/95 px-2.5 py-1.5 shadow-sm backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/95">
        <div
          className="hidden items-center -space-x-1.5 sm:flex"
          aria-label={`当前在线 ${peers.length} 人`}
          data-testid="peer-avatars"
        >
          {peers.slice(0, 4).map((peer) => (
            <div
              key={peer.clientId}
              title={`${peer.user.name}${peer.transport === 'local' ? ' (我)' : peer.transport === 'webrtc' ? ' · WebRTC' : ' · 本地标签'}`}
              style={{ backgroundColor: peer.user.color }}
              className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-xs font-semibold text-white select-none dark:border-zinc-900"
            >
              {peer.user.name.slice(0, 1).toUpperCase()}
            </div>
          ))}
          {peers.length > 4 && (
            <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-stone-200 text-[11px] font-medium text-stone-700 dark:border-zinc-900 dark:bg-zinc-700 dark:text-zinc-200">
              +{peers.length - 4}
            </div>
          )}
        </div>

        <span
          className="font-mono-tabular hidden text-xs text-stone-500 md:inline dark:text-zinc-400"
          data-testid="online-count-label"
        >
          {peers.length} 人在线
        </span>

        <button
          type="button"
          onClick={onOpenCollab}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-xs font-medium whitespace-nowrap text-white transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 shrink-0"
        >
          <Share2 className="h-3.5 w-3.5" />
          <span>多人联机</span>
        </button>
      </div>
    </>
  );
};
