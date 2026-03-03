import React from 'react';
import { useStore } from '../context/Store';
import { formatDate } from '../utils/helpers';
import { downloadJsonDirect, formatDateForFilename, sanitizeFilename } from '../utils/helpers';

const VersionsModal: React.FC = () => {
  const { state, dispatch } = useStore();
  const { ui, versions } = state;

  const getSafeFilename = () => {
    const name = sanitizeFilename(state.projectName || 'flow');
    const dateStr = formatDateForFilename(new Date());
    return `${name}_${dateStr}`;
  };

  if (!ui.showVersions) return null;

  const handleRollback = (id: string) => {
    if (window.confirm('Rollback to this saved version? Current changes will be replaced.')) {
      dispatch({ type: 'ROLLBACK_VERSION', payload: id });
      dispatch({ type: 'TOGGLE_VERSIONS', payload: false });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl p-6 w-full max-w-lg border border-transparent dark:border-zinc-800">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-800 dark:text-white">Version History</h2>
          <button
            onClick={() => dispatch({ type: 'TOGGLE_VERSIONS', payload: false })}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            X
          </button>
        </div>

        <div className="flex items-center justify-between mb-4">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Saved versions: {versions.length} / 3
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={async () => {
                dispatch({ type: 'SAVE_VERSION' });
                const data = {
                  projectName: state.projectName,
                  nodes: state.nodes,
                  contentMap: state.contentMap,
                  metadata: state.metadata,
                  layoutMode: state.layoutMode,
                  ui: state.ui
                };
                await downloadJsonDirect(data, `${getSafeFilename()}.json`);
                dispatch({ type: 'MARK_VERSION_BACKUP' });
              }}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 rounded-md"
            >
              Save Current Version
            </button>
          </div>
        </div>

        {versions.length === 0 ? (
          <div className="h-32 flex items-center justify-center text-sm text-gray-400 dark:text-zinc-600">
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
      </div>
    </div>
  );
};

export default VersionsModal;
