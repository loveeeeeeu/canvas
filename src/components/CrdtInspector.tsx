import React from 'react';
import { X } from 'lucide-react';
import type { SyncEventLog, SyncStats } from '../types/board';

interface CrdtInspectorProps {
  open: boolean;
  stats: SyncStats;
  elementCount: number;
  logs: SyncEventLog[];
  onClose: () => void;
}

export const CrdtInspector: React.FC<CrdtInspectorProps> = ({
  open,
  stats,
  elementCount,
  logs,
  onClose,
}) => {
  if (!open) return null;

  return (
    <aside
      aria-label="CRDT 与 P2P 同步状态监视器"
      className="pointer-events-auto fixed right-4 bottom-16 z-40 flex max-h-[68vh] w-88 flex-col overflow-hidden rounded-xl border border-stone-200 bg-white/95 shadow-xl backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/95"
    >
      <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3 dark:border-zinc-800">
        <div>
          <h3 className="text-xs font-semibold text-stone-900 dark:text-zinc-100">
            Yjs CRDT & P2P 同步监视器
          </h3>
          <p className="font-mono-tabular mt-0.5 text-[11px] text-stone-500 dark:text-zinc-400">
            Room #{stats.roomId} · Client {stats.clientId}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭 CRDT 监视器"
          className="flex h-7 w-7 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4 overflow-y-auto p-4 text-xs">
        {/* Metrics Grid */}
        <div className="grid grid-cols-3 gap-2 border-b border-stone-200 pb-3 dark:border-zinc-800">
          <div>
            <div className="text-[11px] text-stone-500 dark:text-zinc-400">图元总数</div>
            <div className="font-mono-tabular mt-0.5 text-base font-semibold text-stone-900 dark:text-zinc-100">
              {elementCount}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-stone-500 dark:text-zinc-400">发送增量</div>
            <div className="font-mono-tabular mt-0.5 text-base font-semibold text-stone-900 dark:text-zinc-100">
              {stats.updatesSent}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-stone-500 dark:text-zinc-400">合并对端</div>
            <div className="font-mono-tabular mt-0.5 text-base font-semibold text-stone-900 dark:text-zinc-100">
              {stats.updatesReceived}
            </div>
          </div>
        </div>

        {/* Transport Status */}
        <div className="space-y-1.5 border-b border-stone-200 pb-3 dark:border-zinc-800">
          <div className="font-medium text-stone-700 dark:text-zinc-300">传输与持久化通道</div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-stone-600 dark:text-zinc-400">BroadcastChannel（同源多标签）</span>
            <span className="font-mono-tabular font-medium text-emerald-700 dark:text-emerald-400">
              {stats.broadcastConnected ? '已就绪' : '不可用'}
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-stone-600 dark:text-zinc-400">WebRTC DataChannel（跨设备）</span>
            <span className="font-mono-tabular font-medium text-stone-800 dark:text-zinc-200">
              {stats.webrtcPeerCount} 个活跃直连
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-stone-600 dark:text-zinc-400">IndexedDB 离线持久化</span>
            <span className="font-mono-tabular font-medium text-emerald-700 dark:text-emerald-400">
              {stats.indexedDbLoaded ? '已挂载' : '加载中'}
            </span>
          </div>
        </div>

        {/* Vector Clock */}
        <div className="space-y-1.5 border-b border-stone-200 pb-3 dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <span className="font-medium text-stone-700 dark:text-zinc-300">
              CRDT 状态向量 (State Vector)
            </span>
            <span className="font-mono-tabular text-[11px] text-stone-500">
              {stats.stateVectorEntries.length} 节点时钟
            </span>
          </div>
          {stats.stateVectorEntries.length === 0 ? (
            <div className="text-[11px] text-stone-400">暂无操作记录</div>
          ) : (
            <div className="space-y-1">
              {stats.stateVectorEntries.slice(0, 6).map((entry) => (
                <div
                  key={entry.clientId}
                  className="font-mono-tabular flex items-center justify-between text-[11px] text-stone-600 dark:text-zinc-400"
                >
                  <span>
                    Client {entry.clientId}
                    {entry.clientId === stats.clientId ? ' (本机)' : ''}
                  </span>
                  <span className="font-medium text-stone-900 dark:text-zinc-200">
                    clock: {entry.clock}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Event Log */}
        <div className="space-y-1.5">
          <div className="font-medium text-stone-700 dark:text-zinc-300">最近同步事件</div>
          {logs.length === 0 ? (
            <div className="text-[11px] text-stone-400">等待协同同步事件...</div>
          ) : (
            <ul className="space-y-1.5">
              {logs.slice(0, 10).map((log) => (
                <li
                  key={log.id}
                  className="flex items-start justify-between gap-2 text-[11px] leading-snug"
                >
                  <span className="text-stone-700 dark:text-zinc-300">
                    <span className="font-mono-tabular mr-1.5 text-stone-400">
                      {log.direction === 'out' ? '↑' : log.direction === 'in' ? '↓' : '•'}
                    </span>
                    {log.summary}
                  </span>
                  <span className="font-mono-tabular shrink-0 text-[10px] text-stone-400">
                    {new Date(log.timestamp).toLocaleTimeString('zh-CN', {
                      hour12: false,
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
};
