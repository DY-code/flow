import React from 'react';
import { LogNode, ProjectData } from '../types';

interface TaskPlanImportModalProps {
  isOpen: boolean;
  taskPlanData: ProjectData | null;
  selectedNodeId: string | null;
  status: { type: 'idle' | 'loading' | 'error'; message: string };
  isImporting: boolean;
  onSelectNode: (nodeId: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

const STATUS_DOT_CLASS: Record<LogNode['status'], string> = {
  waiting: 'border-gray-400 bg-white dark:border-zinc-500 dark:bg-zinc-900',
  inProgress: 'border-blue-500 bg-blue-500',
  completed: 'border-green-500 bg-green-500',
  onHold: 'border-gray-500 bg-gray-500'
};

const countDescendants = (nodes: LogNode[], nodeId: string): number => {
  const index = nodes.findIndex((node) => node.id === nodeId);
  if (index === -1) return 0;
  const depth = nodes[index].depth;
  let count = 0;

  for (let i = index + 1; i < nodes.length; i += 1) {
    if (nodes[i].depth <= depth) break;
    count += 1;
  }

  return count;
};

const TaskPlanImportModal: React.FC<TaskPlanImportModalProps> = ({
  isOpen,
  taskPlanData,
  selectedNodeId,
  status,
  isImporting,
  onSelectNode,
  onConfirm,
  onClose
}) => {
  if (!isOpen) return null;

  const nodes = taskPlanData?.nodes || [];

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-gray-200 px-5 py-4 dark:border-zinc-700">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">从任务计划导入</h3>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">global/任务计划.json</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-zinc-800"
            >
              关闭
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {status.type === 'loading' && (
            <div className="px-2 py-8 text-sm text-gray-500 dark:text-gray-400">加载任务计划...</div>
          )}

          {status.type === 'error' && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
              {status.message}
            </div>
          )}

          {status.type !== 'loading' && status.type !== 'error' && nodes.length === 0 && (
            <div className="px-2 py-8 text-sm text-gray-500 dark:text-gray-400">任务计划中还没有可导入的节点。</div>
          )}

          {status.type !== 'loading' && status.type !== 'error' && nodes.length > 0 && (
            <div className="space-y-1">
              {nodes.map((node) => {
                const selected = selectedNodeId === node.id;
                const descendantCount = countDescendants(nodes, node.id);

                return (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => onSelectNode(node.id)}
                    className={`flex min-h-[38px] w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors ${
                      selected
                        ? 'border-[color:var(--flow-accent-border)] bg-[color:var(--flow-accent-soft)] text-[color:var(--flow-accent)]'
                        : 'border-transparent text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-zinc-800'
                    }`}
                    style={{ paddingLeft: `${8 + node.depth * 18}px` }}
                  >
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full border ${STATUS_DOT_CLASS[node.status] || STATUS_DOT_CLASS.waiting}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{node.text || 'Untitled'}</span>
                      {node.desc && (
                        <span className="block truncate text-xs text-gray-500 dark:text-gray-400">{node.desc}</span>
                      )}
                    </span>
                    {descendantCount > 0 && (
                      <span className="shrink-0 rounded border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-500 dark:border-zinc-700 dark:text-gray-400">
                        含 {descendantCount} 个子节点
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-4 dark:border-zinc-700">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:border-zinc-600 dark:text-gray-200 dark:hover:bg-zinc-800"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!selectedNodeId || isImporting || status.type !== 'idle'}
            className="rounded-lg bg-[color:var(--flow-accent)] px-3 py-2 text-sm text-white hover:bg-[color:var(--flow-accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isImporting ? '导入中...' : '导入选中节点'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TaskPlanImportModal;
