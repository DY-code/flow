import React, { useState } from 'react';
import { useStore } from '../context/Store';
import { formatCompactDateTime, formatDate } from '../utils/helpers';
import { ProjectData } from '../types';

interface GitHistoryConfig {
  repoUrl: string;
  projectName: string;
  projectPath: string;
  proxyEnabled: boolean;
  httpProxy: string;
  httpsProxy: string;
}

interface GitHistoryEntry {
  hash: string;
  shortHash: string;
  authorDate: string;
  commitDate: string;
  authorName: string;
  subject: string;
}

interface GitProjectVersion {
  projectPath: string;
  file: string;
  commitHash: string;
  projectData: ProjectData;
  summary: {
    projectName: string;
    nodeCount: number;
    lastModified: string | null;
  };
}

interface VersionsModalProps {
  onSaveCurrentVersion: () => Promise<void>;
  gitHistoryConfig: GitHistoryConfig;
  hasUnsavedChanges: boolean;
  onRestoreGithubVersion: (projectData: ProjectData, projectPath: string) => void | Promise<void>;
}

const VersionsModal: React.FC<VersionsModalProps> = ({
  onSaveCurrentVersion,
  gitHistoryConfig,
  hasUnsavedChanges,
  onRestoreGithubVersion
}) => {
  const { state, dispatch } = useStore();
  const { ui, versions } = state;
  const [showGithubHistory, setShowGithubHistory] = useState(false);
  const [gitHistory, setGitHistory] = useState<GitHistoryEntry[]>([]);
  const [gitHistoryStatus, setGitHistoryStatus] = useState<{ type: 'idle' | 'loading' | 'error'; message: string }>({
    type: 'idle',
    message: ''
  });
  const [selectedGitVersion, setSelectedGitVersion] = useState<GitProjectVersion | null>(null);
  const [loadingGitVersionHash, setLoadingGitVersionHash] = useState<string | null>(null);

  if (!ui.showVersions) return null;

  const buildGitPayload = (extra: Record<string, unknown> = {}) => ({
    repoUrl: gitHistoryConfig.repoUrl.trim(),
    projectName: gitHistoryConfig.projectName,
    projectPath: gitHistoryConfig.projectPath,
    proxyEnabled: gitHistoryConfig.proxyEnabled,
    httpProxy: gitHistoryConfig.httpProxy,
    httpsProxy: gitHistoryConfig.httpsProxy,
    ...extra
  });

  const handleRollback = (id: string) => {
    if (window.confirm('Rollback to this saved version? Current changes will be replaced.')) {
      dispatch({ type: 'ROLLBACK_VERSION', payload: id });
      dispatch({ type: 'TOGGLE_VERSIONS', payload: false });
    }
  };

  const handleLoadGithubHistory = async () => {
    setShowGithubHistory(true);
    setSelectedGitVersion(null);

    if (!gitHistoryConfig.repoUrl.trim()) {
      setGitHistoryStatus({ type: 'error', message: '请先在“推送到 GitHub”中填写并保存仓库地址。' });
      return;
    }
    if (!gitHistoryConfig.projectPath) {
      setGitHistoryStatus({ type: 'error', message: '当前项目缺少可用于 GitHub 历史查询的项目路径。' });
      return;
    }

    setGitHistoryStatus({ type: 'loading', message: '正在读取 GitHub 历史版本...' });

    try {
      const response = await fetch('/api/git/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildGitPayload())
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.error || '读取 GitHub 历史失败');
      }

      setGitHistory(Array.isArray(result?.history) ? result.history : []);
      setGitHistoryStatus({ type: 'idle', message: '' });
    } catch (error: any) {
      setGitHistory([]);
      setGitHistoryStatus({
        type: 'error',
        message: error?.message || '读取 GitHub 历史失败。请检查本地 Git 服务、仓库地址和网络。'
      });
    }
  };

  const handleViewGithubVersion = async (entry: GitHistoryEntry) => {
    setLoadingGitVersionHash(entry.hash);

    try {
      const response = await fetch('/api/git/version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildGitPayload({ commitHash: entry.hash }))
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.error || '读取 GitHub 历史版本失败');
      }

      setSelectedGitVersion(result as GitProjectVersion);
    } catch (error: any) {
      alert(error?.message || '读取 GitHub 历史版本失败。');
    } finally {
      setLoadingGitVersionHash(null);
    }
  };

  const handleRestoreGithubVersion = async () => {
    if (!selectedGitVersion) return;
    if (hasUnsavedChanges) {
      alert('当前项目有未保存修改。请先导出 JSON、保存版本或推送 GitHub 后再回溯。');
      return;
    }

    const confirmed = window.confirm([
      '确定回溯到这个 GitHub 历史版本吗？',
      '',
      `项目：${selectedGitVersion.summary.projectName || 'Untitled Project'}`,
      `提交：${selectedGitVersion.commitHash.slice(0, 7)}`,
      '',
      '这只会覆盖当前应用状态和浏览器缓存，不会修改磁盘 JSON 文件。'
    ].join('\n'));
    if (!confirmed) return;

    await onRestoreGithubVersion(selectedGitVersion.projectData, selectedGitVersion.projectPath);
    dispatch({ type: 'TOGGLE_VERSIONS', payload: false });
    alert('已回溯到所选 GitHub 历史版本。请按需手动导出或推送保存。');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl p-6 w-full max-w-4xl border border-transparent dark:border-zinc-800">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-800 dark:text-white">Version History</h2>
          <button
            onClick={() => dispatch({ type: 'TOGGLE_VERSIONS', payload: false })}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            X
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Saved versions: {versions.length} / 3
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void handleLoadGithubHistory()}
              className="px-3 py-1.5 text-xs font-semibold text-[color:var(--flow-accent)] bg-[color:var(--flow-accent-soft)] hover:bg-[color:var(--flow-accent-soft-hover)] rounded-md"
            >
              查看 GitHub 历史版本
            </button>
            <button
              onClick={() => void onSaveCurrentVersion()}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 rounded-md"
            >
              Save Current Version
            </button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.95fr)]">
          <section>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500">Local Versions</div>
            {versions.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-sm text-gray-400 dark:text-zinc-600 border border-dashed border-gray-200 dark:border-zinc-800 rounded-lg">
                No saved versions yet.
              </div>
            ) : (
              <div className="space-y-2 max-h-80 overflow-auto">
                {versions.map((version) => (
                  <div
                    key={version.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-800/60"
                  >
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      {formatDate(version.createdAt)}
                    </div>
                    <button
                      onClick={() => handleRollback(version.id)}
                      className="px-2.5 py-1 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-zinc-700 border border-gray-200 dark:border-zinc-600 rounded-md hover:bg-gray-100 dark:hover:bg-zinc-600"
                    >
                      Rollback
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className={showGithubHistory ? '' : 'hidden lg:block'}>
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500">GitHub Versions</div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  GitHub 历史读取会复用“推送到 GitHub”中的仓库地址与代理设置。
                </div>
              </div>
              {showGithubHistory && (
                <button
                  onClick={() => void handleLoadGithubHistory()}
                  disabled={gitHistoryStatus.type === 'loading'}
                  className="rounded-md px-2 py-1 text-xs text-[color:var(--flow-accent-muted)] hover:bg-[color:var(--flow-accent-soft)] hover:text-[color:var(--flow-accent)] disabled:cursor-wait disabled:opacity-60"
                >
                  刷新
                </button>
              )}
            </div>

            {!showGithubHistory ? (
              <div className="h-32 flex items-center justify-center text-sm text-gray-400 dark:text-zinc-600 border border-dashed border-gray-200 dark:border-zinc-800 rounded-lg">
                点击“查看 GitHub 历史版本”读取远端记录。
              </div>
            ) : (
              <div className="space-y-3">
                {gitHistoryStatus.type === 'loading' && (
                  <div className="h-24 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 border border-dashed border-gray-200 dark:border-zinc-800 rounded-lg">
                    {gitHistoryStatus.message}
                  </div>
                )}

                {gitHistoryStatus.type === 'error' && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                    {gitHistoryStatus.message}
                  </div>
                )}

                {gitHistoryStatus.type !== 'loading' && gitHistoryStatus.type !== 'error' && gitHistory.length === 0 && (
                  <div className="h-24 flex items-center justify-center text-sm text-gray-400 dark:text-zinc-600 border border-dashed border-gray-200 dark:border-zinc-800 rounded-lg">
                    没有找到当前项目的 GitHub 历史版本。
                  </div>
                )}

                {gitHistory.length > 0 && (
                  <div className="space-y-2 max-h-52 overflow-auto">
                    {gitHistory.map((entry) => (
                      <div
                        key={entry.hash}
                        className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-zinc-800 dark:bg-zinc-800/60"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-gray-700 dark:text-gray-200">
                            {gitHistoryConfig.projectPath} · {formatCompactDateTime(entry.commitDate)} · {entry.shortHash}
                          </div>
                          <div className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                            提交信息：{entry.subject || '-'} · {entry.authorName}
                          </div>
                        </div>
                        <button
                          onClick={() => void handleViewGithubVersion(entry)}
                          disabled={loadingGitVersionHash === entry.hash}
                          className="shrink-0 px-2.5 py-1 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-zinc-700 border border-gray-200 dark:border-zinc-600 rounded-md hover:bg-gray-100 disabled:cursor-wait disabled:opacity-60 dark:hover:bg-zinc-600"
                        >
                          {loadingGitVersionHash === entry.hash ? '读取中...' : '查看'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {selectedGitVersion && (
                  <div className="rounded-lg border border-[color:var(--flow-accent-border)] bg-[color:var(--flow-accent-soft)] p-3">
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {selectedGitVersion.summary.projectName || 'Untitled Project'}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-300">
                      <div>节点数：{selectedGitVersion.summary.nodeCount}</div>
                      <div>提交：{selectedGitVersion.commitHash.slice(0, 7)}</div>
                      <div>最近修改：{formatCompactDateTime(selectedGitVersion.summary.lastModified) || '-'}</div>
                      <div className="truncate" title={selectedGitVersion.file}>文件：{selectedGitVersion.file}</div>
                    </div>
                    <div className="mt-3 flex justify-end">
                      <button
                        onClick={() => void handleRestoreGithubVersion()}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-[color:var(--flow-accent)] hover:bg-[color:var(--flow-accent-strong)] rounded-md"
                      >
                        回溯到此版本
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default VersionsModal;
