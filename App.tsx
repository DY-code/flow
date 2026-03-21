import React, { useRef, useState, useEffect, useCallback } from 'react';
import { StoreProvider, useStore } from './context/Store';
import OutlineTree from './components/OutlineTree';
import Editor from './components/Editor';
import StatsModal from './components/StatsModal';
import VersionsModal from './components/VersionsModal';
import SplitPane from './components/SplitPane';
import { 
    IconDownload, IconUpload, IconChart, IconMenu, 
    IconLayoutHorizontal, IconLayoutVertical, IconListDetails, IconFilePlus,
    IconSun, IconMoon, IconViewSplit, IconViewEditor, IconViewOutline,
    IconHome, IconChevronRight, IconChevronDown, IconGitCommit, IconMinus, IconSquare
} from './components/Icons';
import { downloadJson, downloadJsonDirect, downloadMarkdown, formatCompactDateTime, formatDateForFilename, sanitizeFilename } from './utils/helpers';
import { ProjectData, LogNode, BackgroundPreset } from './types';

interface RecentProjectEntry {
  name: string;
  displayName: string;
  relativePath: string;
  isGlobal: boolean;
  modifiedAt: string;
}

interface RecentProjectsResponse {
  projects: RecentProjectEntry[];
  canCreateDefaultTaskPlan?: boolean;
  error?: string;
}

interface ProjectFileResponse {
  projectPath: string;
  projectData: ProjectData;
  generatedCount?: number;
  updatedCount?: number;
}

const buildProjectExportPickerId = (projectData: Pick<ProjectData, 'currentProjectPath' | 'metadata' | 'projectName'>): string => {
  const rawKey = projectData.currentProjectPath || projectData.metadata?.createdAt || projectData.projectName || 'untitled-project';
  let hash = 0;

  for (let i = 0; i < rawKey.length; i += 1) {
    hash = (hash * 31 + rawKey.charCodeAt(i)) >>> 0;
  }

  return `flow-export-${hash.toString(36)}`;
};

const BACKGROUND_PRESETS: Array<{ id: BackgroundPreset; label: string; description: string; swatch: string; light: string; dark: string }> = [
  { id: 'default', label: '默认', description: '保持当前系统背景', swatch: '#D4D4D8', light: '#f3f4f6', dark: '#09090b' },
  { id: 'warm', label: '暖灰米白', description: '柔和、纸面感更强', swatch: '#F3EFE6', light: '#F3EFE6', dark: '#2E2A24' },
  { id: 'mist', label: '浅雾蓝灰', description: '冷静、清爽', swatch: '#E8EEF2', light: '#E8EEF2', dark: '#232C33' },
  { id: 'sage', label: '浅鼠尾草绿', description: '安静、放松', swatch: '#E7EFE8', light: '#E7EFE8', dark: '#243028' }
];

const ACCENT_PRESETS: Record<BackgroundPreset, { accent: string; accentStrong: string; accentSoft: string; accentSoftHover: string; accentBorder: string; accentMuted: string }> = {
  default: {
    accent: '#2563EB',
    accentStrong: '#1D4ED8',
    accentSoft: 'rgba(37, 99, 235, 0.12)',
    accentSoftHover: 'rgba(37, 99, 235, 0.18)',
    accentBorder: 'rgba(37, 99, 235, 0.34)',
    accentMuted: '#5B7BC5'
  },
  warm: {
    accent: '#A56A2A',
    accentStrong: '#8A531C',
    accentSoft: 'rgba(165, 106, 42, 0.12)',
    accentSoftHover: 'rgba(165, 106, 42, 0.18)',
    accentBorder: 'rgba(165, 106, 42, 0.34)',
    accentMuted: '#8C6A40'
  },
  mist: {
    accent: '#3D6F8E',
    accentStrong: '#2F5A74',
    accentSoft: 'rgba(61, 111, 142, 0.12)',
    accentSoftHover: 'rgba(61, 111, 142, 0.18)',
    accentBorder: 'rgba(61, 111, 142, 0.34)',
    accentMuted: '#5C7C92'
  },
  sage: {
    accent: '#4F7A5A',
    accentStrong: '#3E6248',
    accentSoft: 'rgba(79, 122, 90, 0.12)',
    accentSoftHover: 'rgba(79, 122, 90, 0.18)',
    accentBorder: 'rgba(79, 122, 90, 0.34)',
    accentMuted: '#64816B'
  }
};

// --- Extracted Components for Stability ---

const FocusArea: React.FC = () => {
    const { state, dispatch } = useStore();
    const internalSplit = state.layoutMode === 'vertical' ? 'vertical' : 'horizontal';

    // Breadcrumb Logic
    const getBreadcrumbs = () => {
        if (!state.focusedNodeId) return [];
        
        const path: LogNode[] = [];
        const { nodes } = state;
        const targetIndex = nodes.findIndex(n => n.id === state.focusedNodeId);
        
        if (targetIndex === -1) return [];

        let currentNode = nodes[targetIndex];
        path.unshift(currentNode);

        // Traverse backwards to find parents
        for (let i = targetIndex - 1; i >= 0; i--) {
            if (nodes[i].depth < currentNode.depth) {
                currentNode = nodes[i];
                path.unshift(currentNode);
                if (currentNode.depth === 0) break;
            }
        }
        return path;
    };

    const breadcrumbs = getBreadcrumbs();

    return (
        <div className="h-full w-full bg-white/62 dark:bg-zinc-950/62 backdrop-blur-sm flex flex-col transition-colors">
            {/* Header for Focus Area */}
            <div className="h-8 bg-white/60 dark:bg-zinc-900/60 backdrop-blur-sm border-b border-gray-200/80 dark:border-zinc-700/80 flex items-center px-3 justify-between flex-shrink-0 transition-colors group">
                {state.focusedNodeId ? (
                    <div className="flex items-center text-xs font-medium text-gray-600 dark:text-gray-300 overflow-hidden whitespace-nowrap mask-linear-fade">
                        <button 
                            onClick={() => dispatch({ type: 'SET_FOCUSED_NODE', payload: null })}
                            className="hover:text-[color:var(--flow-accent)] p-0.5 rounded flex items-center transition-colors"
                            title="Exit Focus Mode"
                        >
                            <IconHome className="w-3.5 h-3.5" />
                        </button>
                        {breadcrumbs.map((node, i) => (
                            <React.Fragment key={node.id}>
                                <IconChevronRight className="w-3 h-3 mx-1 text-gray-400 flex-shrink-0" />
                                <button
                                    onClick={() => dispatch({ type: 'SET_FOCUSED_NODE', payload: node.id })}
                                    className={`hover:text-[color:var(--flow-accent)] p-0.5 rounded truncate max-w-[120px] transition-colors ${i === breadcrumbs.length - 1 ? 'font-bold text-gray-900 dark:text-gray-100' : ''}`}
                                    title={node.text || 'Untitled'}
                                >
                                    {node.text || 'Untitled'}
                                </button>
                            </React.Fragment>
                        ))}
                    </div>
                ) : (
                    <span className="text-[10px] font-bold text-[color:var(--flow-accent-muted)] uppercase tracking-wider transition-colors">逻辑链 & 思维流</span>
                )}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={() => dispatch({ type: 'TOGGLE_NODE_LAST_MODIFIED' })}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                        title={state.ui.showNodeLastModified ? 'Hide Node Timestamps' : 'Show Node Timestamps'}
                    >
                        <IconSquare className="w-3 h-3" />
                        <span className="hidden sm:inline">{state.ui.showNodeLastModified ? '隐藏节点时间' : '展示节点时间'}</span>
                    </button>
                    <button
                        onClick={() => dispatch({ type: 'TOGGLE_HIDE_ON_HOLD' })}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                        title={state.ui.hideOnHold ? 'Show On Hold Nodes' : 'Hide On Hold Nodes'}
                    >
                        <IconMinus className="w-3 h-3" />
                        <span className="hidden sm:inline">{state.ui.hideOnHold ? '显示搁置' : '隐藏搁置'}</span>
                    </button>
                    <button
                        onClick={() => dispatch({ type: 'TOGGLE_NODE_TEMPLATE' })}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                        title={state.ui.useNodeTemplate ? 'Disable New Node Template' : 'Enable New Node Template'}
                    >
                        <IconFilePlus className="w-3 h-3" />
                        <span className="hidden sm:inline">{state.ui.useNodeTemplate ? '模板开启' : '模板关闭'}</span>
                    </button>
                </div>
            </div>
            
            <div className="flex-1 overflow-hidden">
                <SplitPane 
                    key={internalSplit} 
                    split={internalSplit} 
                    initialSize={internalSplit === 'vertical' ? '40%' : '60%'}
                >
                    <div className={`h-full flex flex-col ${internalSplit === 'vertical' ? 'border-r border-gray-200 dark:border-zinc-700' : ''}`}>
                        <OutlineTree />
                    </div>
                    <div className={`h-full flex flex-col ${internalSplit === 'horizontal' ? 'border-t border-gray-200 dark:border-zinc-700' : ''}`}>
                        <Editor 
                            nodeId={null} 
                            isRoot={true} 
                            key={`root-editor-${state.metadata.createdAt}`} 
                        />
                    </div>
                </SplitPane>
            </div>
        </div>
    );
};

const DetailArea: React.FC = () => {
    const { state } = useStore();
    return <Editor nodeId={state.activeNodeId} key={state.activeNodeId || 'empty'} />;
};

// --- Main App Component ---

const ResearchLogApp: React.FC = () => {
  const { state, dispatch } = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const REPO_URL_STORAGE_KEY = 'flow-github-repo-url';
  const PROXY_ENABLED_STORAGE_KEY = 'flow-github-proxy-enabled';
  const HTTP_PROXY_STORAGE_KEY = 'flow-github-http-proxy';
  const HTTPS_PROXY_STORAGE_KEY = 'flow-github-https-proxy';
  const DEFAULT_HTTP_PROXY = 'http://127.0.0.1:7890';
  const DEFAULT_HTTPS_PROXY = 'http://127.0.0.1:7890';
  
  const viewMode = state.ui.viewMode;
  const isMobile = state.ui.isMobile;
  const isDark = state.ui.theme === 'dark';
  const backgroundPreset = state.ui.backgroundPreset;
  const currentProjectPath = state.currentProjectPath;
  const isGlobalProject = !!currentProjectPath && currentProjectPath.startsWith('global/');
  const isTaskPlanProject = currentProjectPath === 'global/任务计划.json';
  const isTodayTodoProject = currentProjectPath === 'global/今日待办.json';
  const projectLastModifiedLabel = formatCompactDateTime(state.metadata.lastModified);

  // Export Menu State
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [isBackgroundMenuOpen, setIsBackgroundMenuOpen] = useState(false);
  const backgroundMenuRef = useRef<HTMLDivElement>(null);
  const [isRecentProjectsMenuOpen, setIsRecentProjectsMenuOpen] = useState(false);
  const recentProjectsMenuRef = useRef<HTMLDivElement>(null);
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>([]);
  const [recentProjectsStatus, setRecentProjectsStatus] = useState<{ type: 'idle' | 'loading' | 'error'; message: string }>({
    type: 'idle',
    message: ''
  });
  const [canCreateDefaultTaskPlan, setCanCreateDefaultTaskPlan] = useState(false);
  const [isOpeningRecentProject, setIsOpeningRecentProject] = useState<string | null>(null);
  const [isCreatingTaskPlan, setIsCreatingTaskPlan] = useState(false);
  const [isSavingGlobalProject, setIsSavingGlobalProject] = useState(false);
  const [isGeneratingTodayTodos, setIsGeneratingTodayTodos] = useState(false);
  const [isSyncingTodayTodos, setIsSyncingTodayTodos] = useState(false);
  const [isGitPushModalOpen, setIsGitPushModalOpen] = useState(false);
  const [gitRepoUrl, setGitRepoUrl] = useState('');
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [httpProxy, setHttpProxy] = useState(DEFAULT_HTTP_PROXY);
  const [httpsProxy, setHttpsProxy] = useState(DEFAULT_HTTPS_PROXY);
  const [gitPushStatus, setGitPushStatus] = useState<{ type: 'idle' | 'loading' | 'testing' | 'success' | 'error'; message: string }>({
    type: 'idle',
    message: ''
  });
  
  // New Project Menu State
  const [isNewProjectMenuOpen, setIsNewProjectMenuOpen] = useState(false);
  const newProjectMenuRef = useRef<HTMLDivElement>(null);
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const projectNameInputRef = useRef<HTMLInputElement>(null);

  // Unsaved Changes Logic
  const lastModifiedTs = new Date(state.metadata.lastModified).getTime();
  const lastExportedTs = state.metadata.lastExported ? new Date(state.metadata.lastExported).getTime() : 0;
  const lastVersionBackupTs = state.metadata.lastVersionBackupAt ? new Date(state.metadata.lastVersionBackupAt).getTime() : 0;
  const lastChangeEventTs = Math.max(lastExportedTs, lastVersionBackupTs);

  const hasUnsavedChanges = (() => {
    // 1. If nodes are empty or single empty node (initial state), consider saved.
    const isInitialEmpty = state.nodes.length === 1 && !state.nodes[0].text && !state.nodes[0].desc && !state.contentMap[state.nodes[0].id].replace('# \n\n', '').trim();
    if (isInitialEmpty && !state.contentMap['root']) return false;

    // 2. Compare edits against the latest change event (export or version backup)
    // Allow a small grace period (100ms) to avoid race conditions.
    return lastModifiedTs > lastChangeEventTs + 100;
  })();

  const hasCurrentVersionBackup = (() => {
    if (!lastVersionBackupTs) return false;
    // Yellow when not orange and version backup is newer than export.
    return !hasUnsavedChanges && lastVersionBackupTs > lastExportedTs + 100;
  })();

  const activeBackgroundPreset = BACKGROUND_PRESETS.find((preset) => preset.id === backgroundPreset) || BACKGROUND_PRESETS[0];
  const accentPreset = ACCENT_PRESETS[backgroundPreset] || ACCENT_PRESETS.default;
  const appBackgroundColor = isDark ? activeBackgroundPreset.dark : activeBackgroundPreset.light;

  const appChromeStyle = {
    backgroundColor: appBackgroundColor,
    '--flow-accent': accentPreset.accent,
    '--flow-accent-strong': accentPreset.accentStrong,
    '--flow-accent-soft': accentPreset.accentSoft,
    '--flow-accent-soft-hover': accentPreset.accentSoftHover,
    '--flow-accent-border': accentPreset.accentBorder,
    '--flow-accent-muted': accentPreset.accentMuted
  } as React.CSSProperties;

  // Close interceptor
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
        if (hasUnsavedChanges) {
            e.preventDefault();
            e.returnValue = ''; // Required for Chrome
            return ''; // Required for legacy browsers
        }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
        if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
            setIsExportMenuOpen(false);
        }
        if (recentProjectsMenuRef.current && !recentProjectsMenuRef.current.contains(event.target as Node)) {
            setIsRecentProjectsMenuOpen(false);
        }
        if (backgroundMenuRef.current && !backgroundMenuRef.current.contains(event.target as Node)) {
            setIsBackgroundMenuOpen(false);
        }
        if (newProjectMenuRef.current && !newProjectMenuRef.current.contains(event.target as Node)) {
            setIsNewProjectMenuOpen(false);
        }
    };
    if (isExportMenuOpen || isRecentProjectsMenuOpen || isBackgroundMenuOpen || isNewProjectMenuOpen) {
        document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isExportMenuOpen, isRecentProjectsMenuOpen, isBackgroundMenuOpen, isNewProjectMenuOpen]);

  useEffect(() => {
    if (isEditingProjectName) {
        projectNameInputRef.current?.focus();
        projectNameInputRef.current?.select();
    }
  }, [isEditingProjectName]);

  useEffect(() => {
    setGitRepoUrl(localStorage.getItem(REPO_URL_STORAGE_KEY) || '');
    setProxyEnabled(localStorage.getItem(PROXY_ENABLED_STORAGE_KEY) === 'true');
    setHttpProxy(localStorage.getItem(HTTP_PROXY_STORAGE_KEY) || DEFAULT_HTTP_PROXY);
    setHttpsProxy(localStorage.getItem(HTTPS_PROXY_STORAGE_KEY) || DEFAULT_HTTPS_PROXY);
  }, []);

  const loadRecentProjects = useCallback(async () => {
    setRecentProjectsStatus({ type: 'loading', message: '' });

    try {
      const response = await fetch('/api/projects');
      const result = await response.json() as RecentProjectsResponse;
      if (!response.ok) {
        throw new Error(result?.error || '读取项目列表失败');
      }

      setRecentProjects(Array.isArray(result?.projects) ? result.projects : []);
      setCanCreateDefaultTaskPlan(Boolean(result?.canCreateDefaultTaskPlan));
      setRecentProjectsStatus({ type: 'idle', message: '' });
    } catch (error: any) {
      setRecentProjects([]);
      setCanCreateDefaultTaskPlan(false);
      setRecentProjectsStatus({
        type: 'error',
        message: error?.message || '本地项目服务未启动，最近项目暂不可用。'
      });
    }
  }, []);

  useEffect(() => {
    if (isRecentProjectsMenuOpen) {
      void loadRecentProjects();
    }
  }, [isRecentProjectsMenuOpen, loadRecentProjects]);

  const handleOpenRecentProject = async (project: RecentProjectEntry) => {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm('当前项目有未导出的修改，确定打开其他项目吗？');
      if (!confirmed) return;
    }

    setIsOpeningRecentProject(project.relativePath);

    try {
      const response = await fetch(`/api/projects/open?path=${encodeURIComponent(project.relativePath)}`);
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.error || '读取项目失败');
      }

      dispatch({ type: 'IMPORT_DATA', payload: { data: result.projectData as ProjectData, projectPath: result.projectPath } });
      setIsRecentProjectsMenuOpen(false);
    } catch (error: any) {
      alert(error?.message || '读取项目失败，当前项目未变更。');
    } finally {
      setIsOpeningRecentProject(null);
    }
  };

  const handleCreateDefaultTaskPlan = async () => {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm('当前项目有未导出的修改，确定新建并打开任务计划吗？');
      if (!confirmed) return;
    }

    setIsCreatingTaskPlan(true);

    try {
      const response = await fetch('/api/projects/create-default-task-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.error || '创建任务计划失败');
      }

      dispatch({ type: 'IMPORT_DATA', payload: { data: result.projectData as ProjectData, projectPath: result.projectPath } });
      setIsRecentProjectsMenuOpen(false);
      await loadRecentProjects();
    } catch (error: any) {
      alert(error?.message || '创建任务计划失败，当前项目未变更。');
    } finally {
      setIsCreatingTaskPlan(false);
    }
  };

  const confirmGlobalAction = (action: 'save' | 'generate' | 'sync') => {
    if (action === 'save') {
      return window.confirm('确定将当前内容保存到 global 文件吗？');
    }
    if (action === 'generate') {
      return window.confirm('确定根据任务计划生成今日待办吗？这将覆盖现有今日待办内容。');
    }
    return window.confirm('确定将今日待办的完成情况回写到任务计划吗？');
  };

  const handleSaveGlobalProject = async () => {
    if (!currentProjectPath || !isGlobalProject) return;
    if (!confirmGlobalAction('save')) return;

    setIsSavingGlobalProject(true);
    try {
      const response = await fetch('/api/projects/save-global', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: currentProjectPath,
          projectData: buildProjectData()
        })
      });
      const result = await response.json() as ProjectFileResponse & { error?: string };
      if (!response.ok) {
        throw new Error(result?.error || '保存 global 项目失败');
      }

      dispatch({ type: 'UPDATE_LAST_EXPORTED' });
      await loadRecentProjects();
      alert('已保存到 global。');
    } catch (error: any) {
      alert(error?.message || '保存 global 项目失败。');
    } finally {
      setIsSavingGlobalProject(false);
    }
  };

  const handleGenerateTodayTodos = async () => {
    if (!confirmGlobalAction('generate')) return;

    setIsGeneratingTodayTodos(true);
    try {
      const response = await fetch('/api/projects/generate-today-todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskPlanData: buildProjectData() })
      });
      const result = await response.json() as ProjectFileResponse & { error?: string };
      if (!response.ok) {
        throw new Error(result?.error || '生成今日待办失败');
      }

      dispatch({ type: 'IMPORT_DATA', payload: { data: result.projectData, projectPath: result.projectPath } });
      await loadRecentProjects();
      alert(`已生成今日待办，共 ${result.generatedCount ?? 0} 项。`);
    } catch (error: any) {
      alert(error?.message || '生成今日待办失败。');
    } finally {
      setIsGeneratingTodayTodos(false);
    }
  };

  const handleSyncTodayTodos = async () => {
    if (!confirmGlobalAction('sync')) return;

    setIsSyncingTodayTodos(true);
    try {
      const response = await fetch('/api/projects/sync-today-todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isTodayTodoProject ? { todayTodoData: buildProjectData() } : {})
      });
      const result = await response.json() as {
        taskPlanProjectPath: string;
        taskPlanData: ProjectData;
        todayTodoProjectPath: string;
        todayTodoData: ProjectData;
        updatedCount?: number;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(result?.error || '回写完成情况失败');
      }

      if (isTaskPlanProject) {
        dispatch({ type: 'IMPORT_DATA', payload: { data: result.taskPlanData, projectPath: result.taskPlanProjectPath } });
      } else if (isTodayTodoProject) {
        dispatch({ type: 'UPDATE_LAST_EXPORTED' });
      }
      await loadRecentProjects();
      alert(`已回写完成情况，共同步 ${result.updatedCount ?? 0} 项。`);
    } catch (error: any) {
      alert(error?.message || '回写完成情况失败。');
    } finally {
      setIsSyncingTodayTodos(false);
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string) as ProjectData;
        if (json.nodes && json.contentMap) {
            if(window.confirm('Overwrite current project?')) {
                dispatch({ type: 'IMPORT_DATA', payload: { data: json, projectPath: null } });
            }
        } else {
            alert('Invalid file format.');
        }
      } catch (err) {
        alert('Failed to parse JSON.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const getSafeFilename = () => {
      // Allow unicode letters/numbers but remove system reserved characters
      const name = (state.projectName || 'flow').replace(/[\\/:*?"<>|]/g, '_');
      
      // Use lastModified time, format YYYY-MM-DD_HHMM
      const dateObj = new Date(state.metadata.lastModified);
      const yyyy = dateObj.getFullYear();
      const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
      const dd = String(dateObj.getDate()).padStart(2, '0');
      const hh = String(dateObj.getHours()).padStart(2, '0');
      const min = String(dateObj.getMinutes()).padStart(2, '0');
      
      const dateStr = `${yyyy}-${mm}-${dd}_${hh}${min}`;
      
      return `${name}_${dateStr}`;
  };

  const buildProjectData = (): ProjectData => ({
      projectName: state.projectName,
      nodes: state.nodes,
      contentMap: state.contentMap,
      activeNodeId: state.activeNodeId,
      focusedNodeId: state.focusedNodeId,
      currentProjectPath: state.currentProjectPath,
      metadata: state.metadata,
      layoutMode: state.layoutMode,
      ui: state.ui
  });

  const getVersionBackupFilename = () => {
      const name = sanitizeFilename(state.projectName || 'flow');
      const dateStr = formatDateForFilename(new Date());
      return `${name}_${dateStr}.json`;
  };

  const handleSaveCurrentVersion = useCallback(async () => {
      dispatch({ type: 'SAVE_VERSION' });
      await downloadJsonDirect(buildProjectData(), getVersionBackupFilename());
      dispatch({ type: 'MARK_VERSION_BACKUP' });
  }, [dispatch, state.projectName, state.nodes, state.contentMap, state.metadata, state.layoutMode, state.ui]);

  useEffect(() => {
    const handleVersionSaveShortcut = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if ((!e.ctrlKey && !e.metaKey) || !e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== 's') return;

      e.preventDefault();
      void handleSaveCurrentVersion();
    };

    window.addEventListener('keydown', handleVersionSaveShortcut);
    return () => window.removeEventListener('keydown', handleVersionSaveShortcut);
  }, [handleSaveCurrentVersion]);

  const handleExportJson = async () => {
    const data: ProjectData = buildProjectData();
    const pickerId = buildProjectExportPickerId(data);
    const saved = await downloadJson(data, `${getSafeFilename()}.json`, { pickerId });
    if (saved) {
        dispatch({ type: 'UPDATE_LAST_EXPORTED' });
    }
    setIsExportMenuOpen(false);
  };

  const handleExportMarkdown = async () => {
    const data: ProjectData = buildProjectData();
    const pickerId = buildProjectExportPickerId(data);
    const saved = await downloadMarkdown(data, `${getSafeFilename()}.md`, { pickerId });
    if (saved) {
        dispatch({ type: 'UPDATE_LAST_EXPORTED' });
    }
    setIsExportMenuOpen(false);
  };

  const handleOpenGitPushModal = () => {
    setIsExportMenuOpen(false);
    setGitPushStatus({ type: 'idle', message: '' });
    setIsGitPushModalOpen(true);
  };

  const isValidHttpProxyUrl = (value: string): boolean => /^https?:\/\/.+/i.test(value.trim());

  const validateProxySettings = (): string | null => {
    if (!proxyEnabled) return null;
    if (!isValidHttpProxyUrl(httpProxy)) return 'HTTP 代理地址格式无效，请使用 http:// 或 https:// 开头。';
    if (!isValidHttpProxyUrl(httpsProxy)) return 'HTTPS 代理地址格式无效，请使用 http:// 或 https:// 开头。';
    return null;
  };

  const persistGitSettings = (repoUrl: string) => {
    localStorage.setItem(REPO_URL_STORAGE_KEY, repoUrl);
    localStorage.setItem(PROXY_ENABLED_STORAGE_KEY, String(proxyEnabled));
    localStorage.setItem(HTTP_PROXY_STORAGE_KEY, httpProxy.trim() || DEFAULT_HTTP_PROXY);
    localStorage.setItem(HTTPS_PROXY_STORAGE_KEY, httpsProxy.trim() || DEFAULT_HTTPS_PROXY);
  };

  const buildProxyPayload = () => ({
    proxyEnabled,
    httpProxy: httpProxy.trim() || DEFAULT_HTTP_PROXY,
    httpsProxy: httpsProxy.trim() || DEFAULT_HTTPS_PROXY
  });

  const handlePushToGithub = async () => {
    const repoUrl = gitRepoUrl.trim();
    if (!repoUrl) {
        setGitPushStatus({ type: 'error', message: '请先填写 GitHub 仓库地址。' });
        return;
    }
    const proxyValidationError = validateProxySettings();
    if (proxyValidationError) {
        setGitPushStatus({ type: 'error', message: proxyValidationError });
        return;
    }

    persistGitSettings(repoUrl);
    setGitPushStatus({ type: 'loading', message: `正在推送到 GitHub...（代理${proxyEnabled ? '已启用' : '未启用'}）` });

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 25000);

    try {
        const response = await fetch('/api/git/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                repoUrl,
                projectName: state.projectName,
                projectData: buildProjectData(),
                ...buildProxyPayload()
            })
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result?.error || '推送失败');
        }

        dispatch({ type: 'UPDATE_LAST_EXPORTED' });
        setGitPushStatus({ type: 'success', message: result?.message || '推送成功。' });
    } catch (error: any) {
        const isTimeout = error?.name === 'AbortError';
        setGitPushStatus({
            type: 'error',
            message: isTimeout ? '推送超时，请检查本地 git 服务、网络或凭据配置。' : (error?.message || '推送失败，请检查 git 凭据和网络连接。')
        });
    } finally {
        window.clearTimeout(timeoutId);
    }
  };

  const handleTestGithubConnection = async () => {
    const repoUrl = gitRepoUrl.trim();
    if (!repoUrl) {
        setGitPushStatus({ type: 'error', message: '请先填写 GitHub 仓库地址。' });
        return;
    }
    const proxyValidationError = validateProxySettings();
    if (proxyValidationError) {
        setGitPushStatus({ type: 'error', message: proxyValidationError });
        return;
    }

    persistGitSettings(repoUrl);
    setGitPushStatus({ type: 'testing', message: `正在测试连接...（代理${proxyEnabled ? '已启用' : '未启用'}）` });

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 20000);

    try {
        const response = await fetch('/api/git/test-connection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                repoUrl,
                ...buildProxyPayload()
            })
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result?.error || '连接测试失败');
        }

        setGitPushStatus({ type: 'success', message: result?.message || '连接成功。' });
    } catch (error: any) {
        const isTimeout = error?.name === 'AbortError';
        setGitPushStatus({
            type: 'error',
            message: isTimeout ? '连接测试超时，请检查网络或凭据配置。' : (error?.message || '连接测试失败。')
        });
    } finally {
        window.clearTimeout(timeoutId);
    }
  };

  // --- Logic for New Project with Backup Prompt ---
  const handleSafeAction = (action: () => void) => {
    // Check if project is effectively empty (initial state)
    const isProjectEmpty = state.nodes.length === 1 && !state.nodes[0].text && !state.contentMap['root'];
    
    if (isProjectEmpty) {
        action();
        return;
    }

    // Force Prompt
    if (window.confirm("⚠️ Backup Recommended\n\nDo you want to download a JSON backup of the current project before overwriting it?")) {
        handleExportJson().then(() => {
             // Delay to allow download to initiate before action if legacy, 
             // but with await it should be relatively safe. 
             // Though for legacy download anchor click, it's instant but asynchronous in browser handling.
             setTimeout(() => {
                 action();
             }, 500);
        });
    } else {
        // If they cancelled the download prompt, confirm they really want to proceed without backup
        if (window.confirm("⚠️ Overwrite Warning\n\nThe current project will be replaced and unsaved changes lost. Are you sure you want to proceed without a backup?")) {
            action();
        }
    }
  };

  const performNewProject = () => {
    dispatch({ type: 'RESET_PROJECT' });
    setIsNewProjectMenuOpen(false);
  };

  const performExtractProject = () => {
    if (state.focusedNodeId) {
        dispatch({ type: 'EXTRACT_PROJECT', payload: state.focusedNodeId });
    }
    setIsNewProjectMenuOpen(false);
  };

  const getFocusedNodeText = () => {
      if (!state.focusedNodeId) return 'Focused Node';
      const n = state.nodes.find(node => node.id === state.focusedNodeId);
      return n?.text || 'Untitled';
  };

  // Helper for view mode buttons
  const ViewModeButton = ({ mode, icon: Icon, title }: { mode: 'split' | 'editor' | 'outline', icon: any, title: string }) => (
    <button
        onClick={() => dispatch({ type: 'SET_VIEW_MODE', payload: mode })}
        className={`p-1.5 rounded-md transition-colors ${viewMode === mode ? 'bg-white shadow text-[color:var(--flow-accent)] dark:bg-zinc-700 dark:text-[color:var(--flow-accent)]' : 'text-gray-500 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300'}`}
        title={title}
    >
        <Icon className="w-4 h-4" />
    </button>
  );

  return (
    // Apply .dark class to the top wrapper based on state
    <div className={`${isDark ? 'dark' : ''} h-screen flex flex-col font-sans overflow-hidden transition-colors`} style={appChromeStyle}>
      <div className="h-full flex flex-col text-gray-900 dark:text-gray-100 transition-colors" style={{ backgroundColor: appBackgroundColor }}>
        
        {/* Header */}
        <header className="h-14 bg-white/78 dark:bg-zinc-900/78 backdrop-blur-md border-b border-gray-200/80 dark:border-zinc-800/80 flex items-center justify-between px-4 shadow-sm z-30 flex-shrink-0 relative transition-colors">
            <div className="flex items-center gap-3 flex-1 min-w-0 z-10">
                <div className="relative" ref={recentProjectsMenuRef}>
                    <button
                        onClick={() => setIsRecentProjectsMenuOpen((open) => !open)}
                        className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${isRecentProjectsMenuOpen ? 'border-[color:var(--flow-accent-border)] bg-[color:var(--flow-accent-soft)] text-[color:var(--flow-accent)] dark:border-[color:var(--flow-accent-border)] dark:bg-[color:var(--flow-accent-soft)] dark:text-[color:var(--flow-accent)]' : 'border-[color:var(--flow-accent-border)]/70 bg-white/85 text-[color:var(--flow-accent-muted)] hover:bg-[color:var(--flow-accent-soft)] dark:border-[color:var(--flow-accent-border)] dark:bg-zinc-900/85 dark:text-[color:var(--flow-accent-muted)] dark:hover:bg-zinc-800'}`}
                        title="打开最近项目"
                    >
                        <span>最近项目</span>
                        <IconChevronDown className={`h-3.5 w-3.5 transition-transform ${isRecentProjectsMenuOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {isRecentProjectsMenuOpen && (
                        <div className="absolute left-0 mt-2 w-80 overflow-hidden rounded-xl border border-[color:var(--flow-accent-border)]/70 bg-white shadow-xl dark:border-[color:var(--flow-accent-border)] dark:bg-zinc-900 z-50">
                            <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-800">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">最近项目</div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400">按最近修改时间排序，global 固定置顶</div>
                                    </div>
                                    <button
                                        onClick={() => void loadRecentProjects()}
                                        className="rounded-md px-2 py-1 text-xs text-[color:var(--flow-accent-muted)] hover:bg-[color:var(--flow-accent-soft)] hover:text-[color:var(--flow-accent)] dark:text-[color:var(--flow-accent-muted)] dark:hover:bg-zinc-800 dark:hover:text-[color:var(--flow-accent)]"
                                        title="刷新项目列表"
                                    >
                                        刷新
                                    </button>
                                </div>
                                {recentProjectsStatus.type !== 'error' && canCreateDefaultTaskPlan && (
                                    <div className="mt-3 flex items-center gap-2">
                                        <button
                                            onClick={() => void handleCreateDefaultTaskPlan()}
                                            disabled={isCreatingTaskPlan || isOpeningRecentProject !== null}
                                            className="inline-flex items-center rounded-lg bg-[color:var(--flow-accent)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[color:var(--flow-accent-strong)] disabled:cursor-wait disabled:opacity-70"
                                        >
                                            {isCreatingTaskPlan ? '创建中...' : '新建任务计划'}
                                        </button>
                                        <span className="text-[11px] text-gray-500 dark:text-gray-400">当 global 目录为空时可快速创建默认项目</span>
                                    </div>
                                )}
                            </div>

                            <div className="max-h-80 overflow-y-auto py-1">
                                {recentProjectsStatus.type === 'loading' && (
                                    <div className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">正在读取项目列表...</div>
                                )}

                                {recentProjectsStatus.type === 'error' && (
                                    <div className="px-4 py-4 text-sm text-red-600 dark:text-red-400">
                                        <div>{recentProjectsStatus.message}</div>
                                        <div className="mt-2 text-xs text-red-500/80 dark:text-red-300/80">当前项目仍可继续编辑；恢复本地项目服务后即可重新使用最近项目与默认创建入口。</div>
                                    </div>
                                )}

                                {recentProjectsStatus.type !== 'loading' && recentProjectsStatus.type !== 'error' && recentProjects.length === 0 && (
                                    <div className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">`flow-projects` 中还没有可打开的项目文件。</div>
                                )}

                                {recentProjectsStatus.type !== 'loading' && recentProjectsStatus.type !== 'error' && recentProjects.map((project) => (
                                    <button
                                        key={project.relativePath}
                                        onClick={() => void handleOpenRecentProject(project)}
                                        disabled={isOpeningRecentProject !== null}
                                        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[color:var(--flow-accent-soft)] disabled:cursor-wait disabled:opacity-70 dark:hover:bg-zinc-800"
                                    >
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                {project.isGlobal && (
                                                    <span className="rounded-full bg-[color:var(--flow-accent-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--flow-accent)] dark:bg-[color:var(--flow-accent-soft)] dark:text-[color:var(--flow-accent)]">
                                                        全局
                                                    </span>
                                                )}
                                                <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                                                    {project.displayName}
                                                </span>
                                            </div>
                                            <div className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                                                {project.relativePath}
                                            </div>
                                        </div>
                                        <div className="shrink-0 text-right text-[11px] text-gray-400 dark:text-gray-500">
                                            {isOpeningRecentProject === project.relativePath ? '打开中...' : new Date(project.modifiedAt).toLocaleString('zh-CN', { hour12: false })}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* View Mode Switcher */}
                {isMobile ? (
                    <button 
                        onClick={() => dispatch({ type: 'SET_VIEW_MODE', payload: viewMode === 'editor' ? 'split' : 'editor' })} 
                        className={`p-2 rounded-lg transition-colors ${viewMode !== 'editor' ? 'bg-[color:var(--flow-accent-soft)] text-[color:var(--flow-accent)] dark:bg-[color:var(--flow-accent-soft)] dark:text-[color:var(--flow-accent)]' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-zinc-800'}`}
                        title={viewMode === 'editor' ? "Show Outline" : "Show Editor"}
                    >
                        <IconMenu />
                    </button>
                ) : (
                    <div className="flex items-center bg-gray-100 dark:bg-zinc-800 rounded-lg p-0.5 border border-gray-200 dark:border-zinc-700">
                        <ViewModeButton mode="outline" icon={IconViewOutline} title="Outline Only (Hide Editor)" />
                        <ViewModeButton mode="split" icon={IconViewSplit} title="Split View" />
                        <ViewModeButton mode="editor" icon={IconViewEditor} title="Editor Only (Focus Mode)" />
                    </div>
                )}
                
                {/* Editable Project Name */}
                <div className="group/project-title flex items-center min-w-0 ml-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                        {isEditingProjectName ? (
                            <input 
                                ref={projectNameInputRef}
                                type="text"
                                value={state.projectName}
                                onChange={(e) => dispatch({ type: 'UPDATE_PROJECT_NAME', payload: e.target.value })}
                                onBlur={() => setIsEditingProjectName(false)}
                                onKeyDown={(e) => e.key === 'Enter' && setIsEditingProjectName(false)}
                                className="h-full font-bold text-gray-800 dark:text-gray-100 tracking-tight text-lg bg-transparent border border-transparent focus:border-gray-200 dark:focus:border-zinc-700 focus:bg-gray-50 dark:focus:bg-zinc-800 hover:border-gray-100 dark:hover:border-zinc-800 rounded px-1.5 py-0.5 transition-all outline-none"
                                style={{ maxWidth: '25vw' }}
                                placeholder="Untitled Project"
                                title="Edit project name"
                            />
                        ) : (
                            <button
                                type="button"
                                onClick={() => setIsEditingProjectName(true)}
                                className="font-bold text-gray-800 dark:text-gray-100 tracking-tight text-lg bg-transparent rounded px-1.5 py-0.5 -ml-1.5 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors truncate"
                                style={{ maxWidth: '25vw' }}
                                title="Click to edit project name"
                            >
                                {state.projectName || "Untitled Project"}
                            </button>
                        )}
                        {/* Status Indicator */}
                        <div 
                            className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                hasUnsavedChanges ? 'bg-orange-500 animate-pulse' : hasCurrentVersionBackup ? 'bg-yellow-400' : 'bg-green-500'
                            }`} 
                            title={hasUnsavedChanges ? "Unexported changes" : hasCurrentVersionBackup ? "Current version backed up in Version History" : "All changes exported"}
                        />
                        {!isGlobalProject && projectLastModifiedLabel && (
                            <span className="text-[11px] text-gray-400 dark:text-gray-500 transition-opacity opacity-0 group-hover/project-title:opacity-100 whitespace-nowrap" title="项目最近修改时间">
                                {projectLastModifiedLabel}
                            </span>
                        )}
                        {isGlobalProject && (
                            <div className="ml-1 flex items-center gap-1">
                                <button
                                    onClick={() => void handleSaveGlobalProject()}
                                    disabled={isSavingGlobalProject || isGeneratingTodayTodos || isSyncingTodayTodos}
                                    className="rounded-md border border-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-wait disabled:opacity-70 dark:border-zinc-700 dark:text-gray-200 dark:hover:bg-zinc-800"
                                >
                                    {isSavingGlobalProject ? '保存中...' : '保存到 global'}
                                </button>
                                {isTaskPlanProject && (
                                    <button
                                        onClick={() => void handleGenerateTodayTodos()}
                                        disabled={isSavingGlobalProject || isGeneratingTodayTodos || isSyncingTodayTodos}
                                        className="rounded-md border border-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-wait disabled:opacity-70 dark:border-zinc-700 dark:text-gray-200 dark:hover:bg-zinc-800"
                                    >
                                        {isGeneratingTodayTodos ? '生成中...' : '生成今日待办'}
                                    </button>
                                )}
                                {(isTaskPlanProject || isTodayTodoProject) && (
                                    <button
                                        onClick={() => void handleSyncTodayTodos()}
                                        disabled={isSavingGlobalProject || isGeneratingTodayTodos || isSyncingTodayTodos}
                                        className="rounded-md border border-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-wait disabled:opacity-70 dark:border-zinc-700 dark:text-gray-200 dark:hover:bg-zinc-800"
                                    >
                                        {isSyncingTodayTodos ? '回写中...' : '回写完成情况'}
                                    </button>
                                )}
                            </div>
                        )}
                        {isGlobalProject && projectLastModifiedLabel && (
                            <span className="text-[11px] text-gray-400 dark:text-gray-500 transition-opacity opacity-0 group-hover/project-title:opacity-100 whitespace-nowrap" title="项目最近修改时间">
                                {projectLastModifiedLabel}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Slogan - Centered & Subtle */}
            <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 hidden md:block pointer-events-none select-none">
                <span className="text-xs text-gray-300 dark:text-zinc-700 font-medium tracking-[0.3em]">
                    简化，细分，缩短，放慢。
                </span>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0 z-10">
            {/* View Options Group */}
            <div className="flex items-center bg-gray-50 dark:bg-zinc-800 rounded-lg p-0.5 border border-gray-100 dark:border-zinc-700 transition-colors">
                    <div className="relative" ref={backgroundMenuRef}>
                        <button
                            onClick={() => setIsBackgroundMenuOpen((open) => !open)}
                            className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors ${isBackgroundMenuOpen ? 'bg-[color:var(--flow-accent-soft)] text-[color:var(--flow-accent)] shadow dark:bg-zinc-700 dark:text-[color:var(--flow-accent)]' : 'text-[color:var(--flow-accent-muted)] hover:text-[color:var(--flow-accent)] hover:bg-[color:var(--flow-accent-soft)] dark:text-[color:var(--flow-accent-muted)] dark:hover:text-[color:var(--flow-accent)]'}`}
                            title="选择背景颜色"
                        >
                            <span className="inline-block h-3 w-3 rounded-full border border-white/70 shadow-sm" style={{ backgroundColor: activeBackgroundPreset.swatch }} />
                            <span className="hidden sm:inline">背景</span>
                            <IconChevronDown className={`h-3 w-3 transition-transform ${isBackgroundMenuOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {isBackgroundMenuOpen && (
                            <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-[color:var(--flow-accent-border)]/70 bg-white shadow-xl dark:border-[color:var(--flow-accent-border)] dark:bg-zinc-900 z-50">
                                <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-800">
                                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">背景颜色</div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">全局应用设置，不随项目导入变化</div>
                                </div>
                                <div className="py-1">
                                    {BACKGROUND_PRESETS.map((preset) => {
                                        const selected = preset.id === backgroundPreset;
                                        return (
                                            <button
                                                key={preset.id}
                                                onClick={() => {
                                                    dispatch({ type: 'SET_BACKGROUND_PRESET', payload: preset.id });
                                                    setIsBackgroundMenuOpen(false);
                                                }}
                                                className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors ${selected ? 'bg-[color:var(--flow-accent-soft)] text-[color:var(--flow-accent)] dark:bg-zinc-800 dark:text-[color:var(--flow-accent)]' : 'text-[color:var(--flow-accent-muted)] hover:bg-[color:var(--flow-accent-soft)] hover:text-[color:var(--flow-accent)] dark:text-gray-200 dark:hover:bg-zinc-800 dark:hover:text-[color:var(--flow-accent)]'}`}
                                            >
                                                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/70 shadow-sm" style={{ backgroundColor: preset.swatch }}>
                                                    {selected ? <IconSquare className="h-2.5 w-2.5 text-white" /> : null}
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block text-sm font-medium">{preset.label}</span>
                                                    <span className="block truncate text-[11px] text-gray-500 dark:text-gray-400">{preset.description}</span>
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="w-px h-4 bg-gray-200 dark:bg-zinc-700 mx-1"></div>

                    {/* Theme Toggle */}
                    <button
                        onClick={() => dispatch({ type: 'TOGGLE_THEME' })}
                        className="p-1.5 text-[color:var(--flow-accent-muted)] hover:text-[color:var(--flow-accent)] hover:bg-[color:var(--flow-accent-soft)] rounded-md transition-colors"
                        title="Toggle Theme"
                    >
                        {isDark ? <IconMoon className="w-4 h-4" /> : <IconSun className="w-4 h-4" />}
                    </button>
                    <div className="w-px h-4 bg-gray-200 dark:bg-zinc-700 mx-1"></div>

                    {/* Layout Toggle (Only valid if Split View is active and on Desktop) */}
                    {!isMobile && viewMode === 'split' && (
                    <>
                            <button 
                                onClick={() => dispatch({ type: 'SET_LAYOUT_MODE', payload: 'horizontal' })}
                                className={`p-1.5 rounded-md ${state.layoutMode === 'horizontal' ? 'bg-white shadow text-[color:var(--flow-accent)] dark:bg-zinc-700 dark:text-[color:var(--flow-accent)]' : 'text-[color:var(--flow-accent-muted)] hover:text-[color:var(--flow-accent)] hover:bg-[color:var(--flow-accent-soft)] dark:text-[color:var(--flow-accent-muted)] dark:hover:text-[color:var(--flow-accent)]'}`}
                                title="Side-by-side view"
                            >
                                <IconLayoutHorizontal className="w-4 h-4" />
                            </button>
                            <button 
                                onClick={() => dispatch({ type: 'SET_LAYOUT_MODE', payload: 'vertical' })}
                                className={`p-1.5 rounded-md ${state.layoutMode === 'vertical' ? 'bg-white shadow text-[color:var(--flow-accent)] dark:bg-zinc-700 dark:text-[color:var(--flow-accent)]' : 'text-[color:var(--flow-accent-muted)] hover:text-[color:var(--flow-accent)] hover:bg-[color:var(--flow-accent-soft)] dark:text-[color:var(--flow-accent-muted)] dark:hover:text-[color:var(--flow-accent)]'}`}
                                title="Stacked view"
                            >
                                <IconLayoutVertical className="w-4 h-4" />
                            </button>
                            <div className="w-px h-4 bg-gray-200 dark:bg-zinc-700 mx-1"></div>
                    </>
                    )}
                    
                    {/* Outline Details Toggle */}
                    <button
                        onClick={() => dispatch({ type: 'TOGGLE_OUTLINE_DETAILS' })}
                        className={`p-1.5 rounded-md ${state.ui.showOutlineDetails ? 'bg-white shadow text-[color:var(--flow-accent)] dark:bg-zinc-700 dark:text-[color:var(--flow-accent)]' : 'text-[color:var(--flow-accent-muted)] hover:text-[color:var(--flow-accent)] hover:bg-[color:var(--flow-accent-soft)] dark:text-[color:var(--flow-accent-muted)] dark:hover:text-[color:var(--flow-accent)]'}`}
                        title={state.ui.showOutlineDetails ? "Hide node descriptions" : "Show node descriptions"}
                    >
                        <IconListDetails className="w-4 h-4" />
                    </button>
            </div>

            <button 
                    onClick={() => dispatch({ type: 'TOGGLE_STATS', payload: true })}
                    className="p-2 text-gray-500 hover:text-[color:var(--flow-accent)] hover:bg-[color:var(--flow-accent-soft)] dark:text-gray-400 dark:hover:bg-zinc-800 dark:hover:text-[color:var(--flow-accent)] rounded-lg transition-colors"
                    title="Statistics"
                >
                    <IconChart className="w-5 h-5" />
                </button>
                <button
                    onClick={() => dispatch({ type: 'TOGGLE_VERSIONS', payload: true })}
                    className="p-2 text-gray-500 hover:text-[color:var(--flow-accent)] hover:bg-[color:var(--flow-accent-soft)] dark:text-gray-400 dark:hover:bg-zinc-800 dark:hover:text-[color:var(--flow-accent)] rounded-lg transition-colors"
                    title="Version History"
                >
                    <IconGitCommit className="w-5 h-5" />
                </button>
                <div className="h-6 w-px bg-gray-200 dark:bg-zinc-800 mx-1"></div>
                
                {/* New Project Button (Modified with Dropdown Logic) */}
                <div className="relative" ref={newProjectMenuRef}>
                    <button 
                        onClick={() => {
                            if (state.focusedNodeId) {
                                setIsNewProjectMenuOpen(!isNewProjectMenuOpen);
                            } else {
                                handleSafeAction(performNewProject);
                            }
                        }}
                        className={`flex items-center gap-1 p-2 rounded-lg transition-colors ${isNewProjectMenuOpen ? 'bg-[color:var(--flow-accent-soft)] dark:bg-zinc-800 text-[color:var(--flow-accent)] dark:text-[color:var(--flow-accent)]' : 'text-[color:var(--flow-accent-muted)] hover:bg-[color:var(--flow-accent-soft)] hover:text-[color:var(--flow-accent)] dark:text-[color:var(--flow-accent-muted)] dark:hover:bg-zinc-800 dark:hover:text-[color:var(--flow-accent)]'}`}
                        title={state.focusedNodeId ? "New Project Options" : "New Empty Project"}
                    >
                        <IconFilePlus className="w-4 h-4" />
                        {state.focusedNodeId && <IconChevronDown className="w-3 h-3" />}
                    </button>

                    {isNewProjectMenuOpen && state.focusedNodeId && (
                        <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-zinc-800 rounded-md shadow-lg py-1 border border-[color:var(--flow-accent-border)]/70 dark:border-[color:var(--flow-accent-border)] z-50">
                            <div className="px-4 py-2 text-xs font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider border-b border-gray-100 dark:border-zinc-700 mb-1">
                                Create New Project
                            </div>
                            <button 
                                onClick={() => handleSafeAction(performNewProject)} 
                                className="block w-full text-left px-4 py-2 text-sm text-[color:var(--flow-accent-muted)] dark:text-gray-200 hover:bg-[color:var(--flow-accent-soft)] hover:text-[color:var(--flow-accent)] dark:hover:bg-zinc-700 dark:hover:text-[color:var(--flow-accent)]"
                            >
                                New Empty Project
                            </button>
                            <button 
                                onClick={() => handleSafeAction(performExtractProject)} 
                                className="block w-full text-left px-4 py-2 text-sm text-[color:var(--flow-accent-muted)] dark:text-gray-200 hover:bg-[color:var(--flow-accent-soft)] hover:text-[color:var(--flow-accent)] dark:hover:bg-zinc-700 dark:hover:text-[color:var(--flow-accent)]"
                            >
                                Extract <span className="font-bold">"{getFocusedNodeText()}"</span>
                            </button>
                        </div>
                    )}
                </div>

                <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 text-[color:var(--flow-accent-muted)] hover:bg-[color:var(--flow-accent-soft)] hover:text-[color:var(--flow-accent)] dark:text-[color:var(--flow-accent-muted)] dark:hover:bg-zinc-800 dark:hover:text-[color:var(--flow-accent)] rounded-lg transition-colors"
                    title="Import JSON"
                >
                    <IconUpload className="w-4 h-4" />
                </button>
                <input type="file" ref={fileInputRef} onChange={handleImport} accept=".json" className="hidden" />

                {/* Export Menu */}
                <div className="relative" ref={exportMenuRef}>
                    <button 
                        onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-[color:var(--flow-accent)] hover:bg-[color:var(--flow-accent-strong)] rounded-lg shadow-sm transition-colors"
                    >
                        <IconDownload className="w-4 h-4" />
                        <span className="hidden sm:inline">Export</span>
                    </button>
                    
                    {isExportMenuOpen && (
                        <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-zinc-800 rounded-md shadow-lg py-1 border border-[color:var(--flow-accent-border)]/70 dark:border-[color:var(--flow-accent-border)] z-50">
                            <button onClick={handleExportJson} className="block w-full text-left px-4 py-2 text-sm text-[color:var(--flow-accent-muted)] dark:text-gray-200 hover:bg-[color:var(--flow-accent-soft)] hover:text-[color:var(--flow-accent)] dark:hover:bg-zinc-700 dark:hover:text-[color:var(--flow-accent)]">Export as JSON</button>
                            <button onClick={handleExportMarkdown} className="block w-full text-left px-4 py-2 text-sm text-[color:var(--flow-accent-muted)] dark:text-gray-200 hover:bg-[color:var(--flow-accent-soft)] hover:text-[color:var(--flow-accent)] dark:hover:bg-zinc-700 dark:hover:text-[color:var(--flow-accent)]">Export as Markdown</button>
                            <button onClick={handleOpenGitPushModal} className="block w-full text-left px-4 py-2 text-sm text-[color:var(--flow-accent-muted)] dark:text-gray-200 hover:bg-[color:var(--flow-accent-soft)] hover:text-[color:var(--flow-accent)] dark:hover:bg-zinc-700 dark:hover:text-[color:var(--flow-accent)]">推送到 GitHub</button>
                        </div>
                    )}
                </div>
            </div>
        </header>

        {/* Main Workspace */}
        <div className="flex-1 overflow-hidden relative">
            {isMobile ? (
                // Mobile Layout (Drawer logic)
                <div className="relative h-full w-full">
                    {/* Drawer is shown if NOT in editor mode */}
                    <div className={`fixed inset-y-0 left-0 z-40 w-3/4 bg-white/62 dark:bg-zinc-950/62 backdrop-blur-sm shadow-2xl transform transition-transform duration-300 ${viewMode !== 'editor' ? 'translate-x-0' : '-translate-x-full'}`}>
                        <FocusArea />
                    </div>
                    {viewMode !== 'editor' && (
                        <div 
                            className="fixed inset-0 bg-black/30 z-30" 
                            onClick={() => dispatch({ type: 'SET_VIEW_MODE', payload: 'editor' })} 
                        />
                    )}
                    <div className="h-full w-full bg-white/62 dark:bg-zinc-950/62">
                        <DetailArea />
                    </div>
                </div>
            ) : (
                // Desktop Layout
                <>
                    {viewMode === 'split' ? (
                        <SplitPane 
                            key={state.layoutMode} 
                            split={state.layoutMode === 'horizontal' ? 'vertical' : 'horizontal'} 
                            initialSize={state.layoutMode === 'horizontal' ? '30%' : '50%'}
                        >
                            <FocusArea />
                            <DetailArea />
                        </SplitPane>
                    ) : viewMode === 'outline' ? (
                         // Outline Only: Show FocusArea full width
                        <div className="h-full w-full bg-white/62 dark:bg-zinc-950/62">
                            <FocusArea />
                        </div>
                    ) : (
                        // Editor Only: Show DetailArea full width
                        <div className="h-full w-full bg-white/62 dark:bg-zinc-950/62">
                            <DetailArea />
                        </div>
                    )}
                </>
            )}
        </div>

        <StatsModal />
        <VersionsModal onSaveCurrentVersion={handleSaveCurrentVersion} />
        {isGitPushModalOpen && (
            <div className="fixed inset-0 bg-black/40 z-[80] flex items-center justify-center p-4" onClick={() => setIsGitPushModalOpen(false)}>
                <div
                    className="w-full max-w-xl rounded-xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="px-5 py-4 border-b border-gray-200 dark:border-zinc-700 flex items-center justify-between">
                        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">推送到 GitHub</h3>
                        <button
                            onClick={() => setIsGitPushModalOpen(false)}
                            className="text-sm px-2 py-1 rounded text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-zinc-800"
                        >
                            关闭
                        </button>
                    </div>
                    <div className="px-5 py-4 space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">仓库地址</label>
                            <input
                                type="text"
                                value={gitRepoUrl}
                                onChange={(e) => setGitRepoUrl(e.target.value)}
                                placeholder="https://github.com/your-name/your-repo.git"
                                className="w-full rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-[color:var(--flow-accent-border)]"
                            />
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                点击“开始推送”会自动保存仓库地址到本地浏览器，并固定推送到 main 分支。
                            </p>
                        </div>
                        <div className="rounded-lg border border-gray-200 dark:border-zinc-700 p-3 space-y-3">
                            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                                <input
                                    type="checkbox"
                                    checked={proxyEnabled}
                                    onChange={(e) => setProxyEnabled(e.target.checked)}
                                    className="h-4 w-4 rounded border-gray-300 text-[color:var(--flow-accent)] focus:ring-[color:var(--flow-accent)]"
                                />
                                启用代理（仅本应用推送生效）
                            </label>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">HTTP Proxy</label>
                                <input
                                    type="text"
                                    value={httpProxy}
                                    onChange={(e) => setHttpProxy(e.target.value)}
                                    placeholder={DEFAULT_HTTP_PROXY}
                                    disabled={!proxyEnabled}
                                    className="w-full rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-[color:var(--flow-accent-border)] disabled:opacity-60"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">HTTPS Proxy</label>
                                <input
                                    type="text"
                                    value={httpsProxy}
                                    onChange={(e) => setHttpsProxy(e.target.value)}
                                    placeholder={DEFAULT_HTTPS_PROXY}
                                    disabled={!proxyEnabled}
                                    className="w-full rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-[color:var(--flow-accent-border)] disabled:opacity-60"
                                />
                            </div>
                        </div>
                        <div className="rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800/60 px-3 py-2">
                            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">状态</p>
                            <p
                                className={`text-sm ${
                                    gitPushStatus.type === 'error'
                                        ? 'text-red-600 dark:text-red-400'
                                        : gitPushStatus.type === 'success'
                                        ? 'text-green-600 dark:text-green-400'
                                        : 'text-gray-700 dark:text-gray-200'
                                }`}
                            >
                                {gitPushStatus.message || '等待开始推送。'}
                            </p>
                        </div>
                    </div>
                    <div className="px-5 py-4 border-t border-gray-200 dark:border-zinc-700 flex items-center justify-end gap-2">
                        <button
                            onClick={() => setIsGitPushModalOpen(false)}
                            className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-zinc-800"
                        >
                            取消
                        </button>
                        <button
                            onClick={handleTestGithubConnection}
                            disabled={gitPushStatus.type === 'loading' || gitPushStatus.type === 'testing'}
                            className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-zinc-800 disabled:opacity-60"
                        >
                            {gitPushStatus.type === 'testing' ? '测试中...' : '测试连接'}
                        </button>
                        <button
                            onClick={handlePushToGithub}
                            disabled={gitPushStatus.type === 'loading' || gitPushStatus.type === 'testing'}
                            className="px-3 py-2 text-sm rounded-lg bg-[color:var(--flow-accent)] text-white hover:bg-[color:var(--flow-accent-strong)] disabled:opacity-60"
                        >
                            {gitPushStatus.type === 'loading' ? '推送中...' : '开始推送'}
                        </button>
                    </div>
                </div>
            </div>
        )}
      </div>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <StoreProvider>
      <ResearchLogApp />
    </StoreProvider>
  );
};

export default App;
