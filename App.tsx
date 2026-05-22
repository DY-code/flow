import React, { useRef, useState, useEffect, useCallback } from 'react';
import { StoreProvider, useStore } from './context/Store';
import OutlineTree from './components/OutlineTree';
import MinimalOutlineTree from './components/MinimalOutlineTree';
import Editor from './components/Editor';
import StatsModal from './components/StatsModal';
import VersionsModal from './components/VersionsModal';
import SplitPane from './components/SplitPane';
import TaskPlanImportModal from './components/TaskPlanImportModal';
import MindFlowWindow from './components/MindFlowWindow';
import {
    IconDownload, IconUpload, IconChart, IconMenu, 
    IconLayoutHorizontal, IconListDetails, IconFilePlus,
    IconSun, IconMoon, IconViewSplit, IconViewEditor, IconViewOutline,
    IconHome, IconChevronRight, IconChevronDown, IconGitCommit, IconMinus, IconSquare, IconMindFlow
} from './components/Icons';
import {
    buildMarkdownExport,
    downloadJson,
    downloadJsonDirect,
    downloadMarkdown,
    formatCompactDateTime,
    formatDateForFilename,
    sanitizeFilename,
    readTextFile
} from './utils/helpers';
import {
    type ExportFolderFileEntry,
    type RecentImportedProjectEntry,
    hasProjectExportDirectoryHandle,
    listProjectExportDirectoryFiles,
    loadRecentImportedProjects,
    readRecentImportedProjectFile,
    saveRecentImportedProject,
    writeFileHandle,
    selectProjectExportDirectory
} from './utils/fileHandleStore';
import { cloneSubtreeIntoProject, countNodeDescendants, importProjectAsNodeIntoProject } from './utils/projectImport';
import { ProjectData, LogNode, BackgroundPreset } from './types';

const TASK_PLAN_PROJECT_PATH = 'global/任务计划.json';
const TODAY_TODO_PROJECT_PATH = 'global/今日待办.json';
const IMPORT_PROJECT_JSON_PICKER_ID = 'flow-import-project-json';

type OutlineStyle = 'classic' | 'minimal';

const GLOBAL_INTERACTION_TARGETS = [
  { id: 'taskPlan', label: '任务计划', projectName: '任务计划', projectPath: TASK_PLAN_PROJECT_PATH },
  { id: 'todayTodo', label: '今日待办', projectName: '今日待办', projectPath: TODAY_TODO_PROJECT_PATH }
] as const;

type GlobalInteractionTargetId = typeof GLOBAL_INTERACTION_TARGETS[number]['id'];
type GlobalInteractionTarget = typeof GLOBAL_INTERACTION_TARGETS[number];

const DEFAULT_GLOBAL_INTERACTION_TARGET_ID: GlobalInteractionTargetId = 'taskPlan';

const getGlobalInteractionTarget = (targetId: GlobalInteractionTargetId): GlobalInteractionTarget => (
  GLOBAL_INTERACTION_TARGETS.find((target) => target.id === targetId) || GLOBAL_INTERACTION_TARGETS[0]
);

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

interface OverwriteRiskConfirmData {
  expectedPrefix: string;
  targetFilename: string;
  actualPrefix: string;
}

interface OverwriteFilePickerData {
  title: string;
  description: string;
  files: ExportFolderFileEntry[];
}

const buildImportConfirmationMessage = ({
  sourceNode,
  descendantCount,
  sourceProjectName,
  sourceProjectPath,
  targetProjectName,
  targetProjectPath
}: {
  sourceNode: LogNode;
  descendantCount: number;
  sourceProjectName: string;
  sourceProjectPath: string;
  targetProjectName: string;
  targetProjectPath: string;
}) => [
  '确定执行节点导入吗？',
  '',
  `源节点：${sourceNode.text || 'Untitled'}`,
  `子节点数量：${descendantCount}`,
  `源项目：${sourceProjectName || 'Untitled Project'}`,
  `源路径：${sourceProjectPath}`,
  `目标项目：${targetProjectName || 'Untitled Project'}`,
  `目标路径：${targetProjectPath}`,
  '导入位置：目标项目根级节点末尾',
  '',
  '说明：将复制该节点及全部子节点，并为复制出的节点生成新 ID；不会删除、合并或覆盖目标项目已有节点。'
].join('\n');

const buildProjectAsNodeImportConfirmationMessage = ({
  sourceProjectName,
  sourceFilename,
  sourceNodeCount,
  targetProjectName,
  targetProjectPath
}: {
  sourceProjectName: string;
  sourceFilename: string;
  sourceNodeCount: number;
  targetProjectName?: string | null;
  targetProjectPath?: string | null;
}) => [
  '确定将项目导入为节点吗？',
  '',
  `源项目：${sourceProjectName}`,
  `源文件：${sourceFilename}`,
  `源节点数量：${sourceNodeCount}`,
  `目标项目：${targetProjectName || 'Untitled Project'}`,
  `目标路径：${getProjectPathLabel(targetProjectPath)}`,
  '导入位置：当前项目根级节点末尾',
  '',
  '说明：将创建一个新父节点，并把源项目全部节点作为其子节点导入；不会覆盖当前项目。'
].join('\n');

const getProjectPathLabel = (projectPath?: string | null): string => projectPath || '当前未保存项目';

const buildProjectExportPickerId = (projectData: Pick<ProjectData, 'currentProjectPath' | 'metadata' | 'projectName'>): string => {
  const rawKey = projectData.currentProjectPath || projectData.metadata?.createdAt || projectData.projectName || 'untitled-project';
  let hash = 0;

  for (let i = 0; i < rawKey.length; i += 1) {
    hash = (hash * 31 + rawKey.charCodeAt(i)) >>> 0;
  }

  return `flow-export-${hash.toString(36)}`;
};

const EXPORT_TIMESTAMP_SUFFIX_PATTERN = /_\d{4}-\d{2}-\d{2}_\d{4}$/;

const getExportTargetProjectPrefix = (filename: string, extension: 'json' | 'md'): string => {
  const expectedExtension = `.${extension}`;
  const nameWithoutExtension = filename.toLowerCase().endsWith(expectedExtension)
    ? filename.slice(0, -expectedExtension.length)
    : filename.replace(/\.[^/.]+$/, '');

  return nameWithoutExtension.replace(EXPORT_TIMESTAMP_SUFFIX_PATTERN, '');
};

const getSafeProjectFilenameBase = (projectName?: string | null): string => {
  return sanitizeFilename(projectName || 'flow') || 'flow';
};

const getGitBackupProjectFilenameBase = (projectName?: string | null): string => {
  const fallback = 'untitled-project';
  const safe = String(projectName || fallback)
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_');
  return safe || fallback;
};

const getFilenameWithoutJsonExtension = (filename: string): string => {
  return filename.toLowerCase().endsWith('.json') ? filename.slice(0, -5) : filename.replace(/\.[^/.]+$/, '');
};

const isProjectData = (value: unknown): value is ProjectData => {
  const data = value as ProjectData;
  return !!data && Array.isArray(data.nodes) && !!data.contentMap && typeof data.contentMap === 'object';
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

interface FocusAreaProps {
    onOpenMindFlow: () => void;
    outlineStyle: OutlineStyle;
    onToggleOutlineStyle: () => void;
}

const FocusArea: React.FC<FocusAreaProps> = ({ onOpenMindFlow, outlineStyle, onToggleOutlineStyle }) => {
    const { state, dispatch } = useStore();
    const internalSplit = 'horizontal';

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
                    <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-[color:var(--flow-accent-muted)] uppercase tracking-wider transition-colors">逻辑链 & 思维流</span>
                        <button
                            type="button"
                            onClick={onToggleOutlineStyle}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                                outlineStyle === 'minimal'
                                    ? 'bg-[color:var(--flow-accent-soft)] text-[color:var(--flow-accent)]'
                                    : 'text-[color:var(--flow-accent-muted)] hover:bg-[color:var(--flow-accent-soft)] hover:text-[color:var(--flow-accent)]'
                            }`}
                            title={outlineStyle === 'minimal' ? '切换到经典大纲' : '切换到简约大纲'}
                        >
                            {outlineStyle === 'minimal' ? '简约' : '经典'}
                        </button>
                        <button
                            type="button"
                            onClick={onOpenMindFlow}
                            className="rounded p-1 text-[color:var(--flow-accent-muted)] transition-colors hover:bg-[color:var(--flow-accent-soft)] hover:text-[color:var(--flow-accent)]"
                            title="打开思维流视图"
                        >
                            <IconMindFlow className="h-3.5 w-3.5" />
                        </button>
                    </div>
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
                    initialSize="60%"
                >
                    <div className="h-full flex flex-col">
                        {outlineStyle === 'minimal' ? <MinimalOutlineTree /> : <OutlineTree />}
                    </div>
                    <div className="h-full flex flex-col border-t border-gray-200 dark:border-zinc-700">
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

interface DetailPaneProps {
    pane: 0 | 1;
}

const DetailPane: React.FC<DetailPaneProps> = ({ pane }) => {
    const { state, dispatch } = useStore();
    const nodeId = state.detailPaneNodeIds[pane];
    const isActivePane = state.activeDetailPane === pane;

    return (
        <div
            className={`h-full min-h-0 border-2 transition-colors ${
                isActivePane
                    ? 'border-[color:var(--flow-accent-border)]'
                    : 'border-transparent opacity-90'
            }`}
            onMouseDown={() => dispatch({ type: 'SET_ACTIVE_DETAIL_PANE', payload: pane })}
        >
            <Editor
                nodeId={nodeId}
                textReadOnly={!isActivePane}
                key={`detail-pane-${pane}-${nodeId || 'empty'}`}
            />
        </div>
    );
};

const DualDetailArea: React.FC = () => {
    const { state } = useStore();
    const split = state.dualDetailLayout === 'stacked' ? 'horizontal' : 'vertical';

    return (
        <SplitPane key={`dual-detail-${state.dualDetailLayout}`} split={split} initialSize="50%">
            <DetailPane pane={0} />
            <DetailPane pane={1} />
        </SplitPane>
    );
};

// --- Main App Component ---

const ResearchLogApp: React.FC = () => {
  const { state, dispatch } = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importProjectAsNodeInputRef = useRef<HTMLInputElement>(null);
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
  const isNonGlobalProject = !isGlobalProject;
  const isTaskPlanProject = currentProjectPath === TASK_PLAN_PROJECT_PATH;
  const isTodayTodoProject = currentProjectPath === TODAY_TODO_PROJECT_PATH;
  const projectLastModifiedLabel = formatCompactDateTime(state.metadata.lastModified);

  // Export Menu State
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isImportMenuOpen, setIsImportMenuOpen] = useState(false);
  const [hasProjectExportFolder, setHasProjectExportFolder] = useState(false);
  const [isExportFolderNoticeOpen, setIsExportFolderNoticeOpen] = useState(false);
  const importMenuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const exportFolderNoticeResolveRef = useRef<((shouldContinue: boolean) => void) | null>(null);
  const [overwriteFilePicker, setOverwriteFilePicker] = useState<OverwriteFilePickerData | null>(null);
  const overwriteFilePickerResolveRef = useRef<((file: ExportFolderFileEntry | null) => void) | null>(null);
  const [overwriteRiskConfirm, setOverwriteRiskConfirm] = useState<OverwriteRiskConfirmData | null>(null);
  const overwriteRiskConfirmResolveRef = useRef<((confirmed: boolean) => void) | null>(null);
  const [isBackgroundMenuOpen, setIsBackgroundMenuOpen] = useState(false);
  const backgroundMenuRef = useRef<HTMLDivElement>(null);
  const [isRecentProjectsMenuOpen, setIsRecentProjectsMenuOpen] = useState(false);
  const recentProjectsMenuRef = useRef<HTMLDivElement>(null);
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>([]);
  const [recentImportedProjects, setRecentImportedProjects] = useState<RecentImportedProjectEntry[]>([]);
  const [isGithubProjectsListOpen, setIsGithubProjectsListOpen] = useState(false);
  const [isOpeningRecentImportedProjectId, setIsOpeningRecentImportedProjectId] = useState<string | null>(null);
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
  const [isImportingPlanNode, setIsImportingPlanNode] = useState(false);
  const [isGlobalInteractionMenuOpen, setIsGlobalInteractionMenuOpen] = useState(false);
  const [selectedGlobalInteractionTargetId, setSelectedGlobalInteractionTargetId] = useState<GlobalInteractionTargetId>(DEFAULT_GLOBAL_INTERACTION_TARGET_ID);
  const [activeGlobalImportTargetId, setActiveGlobalImportTargetId] = useState<GlobalInteractionTargetId>(DEFAULT_GLOBAL_INTERACTION_TARGET_ID);
  const [isTaskPlanImportModalOpen, setIsTaskPlanImportModalOpen] = useState(false);
  const [taskPlanImportData, setTaskPlanImportData] = useState<ProjectData | null>(null);
  const [selectedTaskPlanNodeId, setSelectedTaskPlanNodeId] = useState<string | null>(null);
  const [taskPlanImportStatus, setTaskPlanImportStatus] = useState<{ type: 'idle' | 'loading' | 'error'; message: string }>({
    type: 'idle',
    message: ''
  });
  const [isGitPushModalOpen, setIsGitPushModalOpen] = useState(false);
  const [gitRepoUrl, setGitRepoUrl] = useState('');
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [httpProxy, setHttpProxy] = useState(DEFAULT_HTTP_PROXY);
  const [httpsProxy, setHttpsProxy] = useState(DEFAULT_HTTPS_PROXY);
  const [gitPushStatus, setGitPushStatus] = useState<{ type: 'idle' | 'loading' | 'testing' | 'success' | 'error'; message: string }>({
    type: 'idle',
    message: ''
  });
  const [latestProjectStatusEvent, setLatestProjectStatusEvent] = useState<'unsaved' | 'exported' | 'versionBackup' | 'githubPushed'>('exported');
  
  // New Project Menu State
  const [isNewProjectMenuOpen, setIsNewProjectMenuOpen] = useState(false);
  const newProjectMenuRef = useRef<HTMLDivElement>(null);
  const globalInteractionMenuRef = useRef<HTMLDivElement>(null);
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const projectNameInputRef = useRef<HTMLInputElement>(null);
  const [isMindFlowOpen, setIsMindFlowOpen] = useState(false);
  const [outlineStyle, setOutlineStyle] = useState<OutlineStyle>('classic');

  useEffect(() => {
    return () => {
      overwriteRiskConfirmResolveRef.current?.(false);
      overwriteRiskConfirmResolveRef.current = null;
    };
  }, []);

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

  const projectStatusIndicator = (() => {
    if (latestProjectStatusEvent === 'unsaved') {
      return {
        className: 'bg-orange-500 animate-pulse',
        title: 'Unexported changes'
      };
    }

    if (latestProjectStatusEvent === 'githubPushed') {
      return {
        className: 'bg-[#8fb7c9]',
        title: 'GitHub push successful'
      };
    }

    if (latestProjectStatusEvent === 'versionBackup') {
      return {
        className: 'bg-yellow-400',
        title: 'Current version backed up in Version History'
      };
    }

    return {
      className: 'bg-green-500',
      title: 'All changes exported'
    };
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
        if (importMenuRef.current && !importMenuRef.current.contains(event.target as Node)) {
            setIsImportMenuOpen(false);
        }
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
        if (globalInteractionMenuRef.current && !globalInteractionMenuRef.current.contains(event.target as Node)) {
            setIsGlobalInteractionMenuOpen(false);
        }
    };
    if (isImportMenuOpen || isExportMenuOpen || isRecentProjectsMenuOpen || isBackgroundMenuOpen || isNewProjectMenuOpen || isGlobalInteractionMenuOpen) {
        document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isImportMenuOpen, isExportMenuOpen, isRecentProjectsMenuOpen, isBackgroundMenuOpen, isNewProjectMenuOpen, isGlobalInteractionMenuOpen]);

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

  useEffect(() => {
    setLatestProjectStatusEvent(hasUnsavedChanges ? 'unsaved' : 'exported');
  }, [currentProjectPath, state.metadata.createdAt]);

  useEffect(() => {
    if (hasUnsavedChanges) setLatestProjectStatusEvent('unsaved');
  }, [hasUnsavedChanges, lastModifiedTs]);

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

  const refreshRecentImportedProjects = useCallback(async () => {
    setRecentImportedProjects(await loadRecentImportedProjects());
  }, []);

  useEffect(() => {
    if (isRecentProjectsMenuOpen) {
      void refreshRecentImportedProjects();
    }
  }, [isRecentProjectsMenuOpen, refreshRecentImportedProjects]);

  useEffect(() => {
    if (isImportMenuOpen) {
      void refreshRecentImportedProjects();
    }
  }, [isImportMenuOpen, refreshRecentImportedProjects]);

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

  const markProjectExported = () => {
    dispatch({ type: 'UPDATE_LAST_EXPORTED' });
    setLatestProjectStatusEvent('exported');
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

      markProjectExported();
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
        warning?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(result?.error || '回写完成情况失败');
      }

      if (isTaskPlanProject) {
        dispatch({ type: 'IMPORT_DATA', payload: { data: result.taskPlanData, projectPath: result.taskPlanProjectPath } });
      } else if (isTodayTodoProject) {
        dispatch({ type: 'IMPORT_DATA', payload: { data: result.todayTodoData, projectPath: result.todayTodoProjectPath } });
      }
      await loadRecentProjects();
      const successMessage = [`已回写完成情况，共同步 ${result.updatedCount ?? 0} 项。`];
      if (result.warning) {
        successMessage.push(result.warning);
      }
      alert(successMessage.join('\n'));
    } catch (error: any) {
      alert(error?.message || '回写完成情况失败。');
    } finally {
      setIsSyncingTodayTodos(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    await importProjectJsonFile(file);
    e.target.value = '';
  };

  const importProjectJsonFile = async (file: File, handle?: unknown) => {
    try {
      const text = await readTextFile(file);
      const json = JSON.parse(text);
      if (isProjectData(json)) {
        if(window.confirm('Overwrite current project?')) {
          dispatch({ type: 'IMPORT_DATA', payload: { data: json, projectPath: null } });
          if (handle) {
            const nextRecentImports = await saveRecentImportedProject({
              fileName: file.name,
              projectName: json.projectName || file.name,
              handle
            });
            setRecentImportedProjects(nextRecentImports);
          }
        }
      } else {
        alert('Invalid file format.');
      }
    } catch (err: any) {
      alert(err?.message || 'Failed to parse JSON.');
    }
  };

  const handleImportProjectJsonClick = async () => {
    setIsImportMenuOpen(false);

    if (!('showOpenFilePicker' in window)) {
      fileInputRef.current?.click();
      return;
    }

    try {
      const [handle] = await (window as any).showOpenFilePicker({
        id: IMPORT_PROJECT_JSON_PICKER_ID,
        multiple: false,
        types: [{
          description: 'JSON Project',
          accept: { 'application/json': ['.json'] }
        }]
      });

      if (!handle) return;

      const file = await handle.getFile();
      await importProjectJsonFile(file, handle);
    } catch (error: any) {
      if (error?.name === 'AbortError') return;
      alert(error?.message || 'Failed to import JSON.');
    }
  };

  const handleRecentImportedProjectClick = async (entry: RecentImportedProjectEntry) => {
    setIsImportMenuOpen(false);
    setIsRecentProjectsMenuOpen(false);
    setIsOpeningRecentImportedProjectId(entry.id);

    try {
      const file = await readRecentImportedProjectFile(entry);
      await importProjectJsonFile(file, entry.handle);
    } catch (error: any) {
      alert(error?.message || '无法读取最近导入项目，请重新通过 Import JSON 选择文件。');
    } finally {
      setIsOpeningRecentImportedProjectId(null);
    }
  };

  const handleImportProjectAsNode = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await readTextFile(file);
      const sourceProject = JSON.parse(text);

      if (!isProjectData(sourceProject)) {
        alert('Invalid file format.');
        return;
      }

      const parentTitle = (sourceProject.projectName || '').trim()
        || getFilenameWithoutJsonExtension(file.name).trim()
        || 'Imported Project';
      const confirmed = window.confirm(buildProjectAsNodeImportConfirmationMessage({
        sourceProjectName: parentTitle,
        sourceFilename: file.name,
        sourceNodeCount: sourceProject.nodes.length,
        targetProjectName: state.projectName,
        targetProjectPath: currentProjectPath
      }));

      if (!confirmed) return;

      const nextProjectData = importProjectAsNodeIntoProject({
        sourceProject,
        targetProject: buildProjectData(),
        parentTitle
      });

      dispatch({
        type: 'IMPORT_DATA',
        payload: { data: nextProjectData, projectPath: currentProjectPath, markAsUnsaved: true }
      });
      alert(`已导入项目为节点：${parentTitle}。请按需手动保存当前项目。`);
    } catch (err: any) {
      alert(err?.message || '导入项目为节点失败。');
    } finally {
      e.target.value = '';
    }
  };

  const getSafeFilename = () => {
      // Allow unicode letters/numbers but remove system reserved characters
      const name = getSafeProjectFilenameBase(state.projectName);
      
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

  const resolveOverwriteRiskConfirm = (confirmed: boolean) => {
    overwriteRiskConfirmResolveRef.current?.(confirmed);
    overwriteRiskConfirmResolveRef.current = null;
    setOverwriteRiskConfirm(null);
  };

  const confirmExportTargetName = async (targetFilename: string, extension: 'json' | 'md') => {
    const expectedPrefix = getSafeProjectFilenameBase(state.projectName);
    const actualPrefix = getExportTargetProjectPrefix(targetFilename, extension);

    if (actualPrefix === expectedPrefix) {
      return true;
    }

    overwriteRiskConfirmResolveRef.current?.(false);

    return new Promise<boolean>((resolve) => {
      overwriteRiskConfirmResolveRef.current = resolve;
      setOverwriteRiskConfirm({
        expectedPrefix,
        targetFilename,
        actualPrefix: actualPrefix || '无法识别'
      });
    });
  };

  const buildProjectData = (): ProjectData => ({
      projectName: state.projectName,
      nodes: state.nodes,
      contentMap: state.contentMap,
      activeNodeId: state.activeNodeId,
      detailPaneNodeIds: state.detailPaneNodeIds,
      activeDetailPane: state.activeDetailPane,
      focusedNodeId: state.focusedNodeId,
      currentProjectPath: state.currentProjectPath,
      metadata: state.metadata,
      layoutMode: state.layoutMode,
      ui: state.ui
  });

  const getGithubHistoryProjectPath = () => (
    currentProjectPath || `${getGitBackupProjectFilenameBase(state.projectName)}.json`
  );

  const handleRestoreGithubVersion = async (projectData: ProjectData, projectPath: string) => {
    dispatch({
      type: 'IMPORT_DATA',
      payload: { data: projectData, projectPath, markAsUnsaved: true }
    });
    setLatestProjectStatusEvent('unsaved');
  };

  const getCurrentProjectExportPickerId = () => buildProjectExportPickerId({
    currentProjectPath: state.currentProjectPath,
    metadata: state.metadata,
    projectName: state.projectName
  });

  const refreshProjectExportFolderStatus = useCallback(async () => {
    const pickerId = buildProjectExportPickerId({
      currentProjectPath: state.currentProjectPath,
      metadata: state.metadata,
      projectName: state.projectName
    });
    const hasFolder = await hasProjectExportDirectoryHandle(pickerId);
    setHasProjectExportFolder(hasFolder);
  }, [state.currentProjectPath, state.metadata.createdAt, state.projectName]);

  useEffect(() => {
    void refreshProjectExportFolderStatus();
  }, [refreshProjectExportFolderStatus]);

  useEffect(() => {
    if (isExportMenuOpen) {
      void refreshProjectExportFolderStatus();
    }
  }, [isExportMenuOpen, refreshProjectExportFolderStatus]);

  const requestContinueWithoutExportFolder = (): Promise<boolean> => new Promise((resolve) => {
    exportFolderNoticeResolveRef.current = resolve;
    setIsExportFolderNoticeOpen(true);
  });

  const resolveExportFolderNotice = (shouldContinue: boolean) => {
    exportFolderNoticeResolveRef.current?.(shouldContinue);
    exportFolderNoticeResolveRef.current = null;
    setIsExportFolderNoticeOpen(false);
  };

  const ensureProjectExportFolderPrompt = async (pickerId: string): Promise<boolean> => {
    if (!('showDirectoryPicker' in window)) {
      return true;
    }

    const hasFolder = await hasProjectExportDirectoryHandle(pickerId);
    setHasProjectExportFolder(hasFolder);
    if (hasFolder) return true;

    return requestContinueWithoutExportFolder();
  };

  const requestOverwriteTargetFile = (data: OverwriteFilePickerData): Promise<ExportFolderFileEntry | null> => new Promise((resolve) => {
    overwriteFilePickerResolveRef.current = resolve;
    setOverwriteFilePicker(data);
  });

  const resolveOverwriteFilePicker = (file: ExportFolderFileEntry | null) => {
    overwriteFilePickerResolveRef.current?.(file);
    overwriteFilePickerResolveRef.current = null;
    setOverwriteFilePicker(null);
  };

  const selectOverwriteTargetFromExportFolder = async (
    pickerId: string,
    extension: 'json' | 'md',
    label: string
  ): Promise<ExportFolderFileEntry | null> => {
    let files: ExportFolderFileEntry[] | null;

    try {
      files = await listProjectExportDirectoryFiles(pickerId, `.${extension}`);
    } catch (error: any) {
      alert(error?.message || '读取导出目录失败。请在 Export 菜单中重新设置 Set Export Folder。');
      return null;
    }

    if (!files) {
      setHasProjectExportFolder(false);
      alert('请先在 Export 菜单中点击 Set Export Folder 设置导出目录。');
      return null;
    }

    setHasProjectExportFolder(true);

    if (files.length === 0) {
      alert(`当前 Export Folder 中没有可覆盖的 ${label} 文件。`);
      return null;
    }

    return requestOverwriteTargetFile({
      title: `选择覆盖的 ${label} 文件`,
      description: `从当前项目 Export Folder 中选择要覆盖的 ${label} 文件。`,
      files
    });
  };

  const handleSetProjectExportFolder = async () => {
    const pickerId = getCurrentProjectExportPickerId();

    if (!('showDirectoryPicker' in window)) {
      alert('当前浏览器不支持项目导出目录记忆，将继续使用默认文件选择逻辑。');
      setIsExportMenuOpen(false);
      return;
    }

    try {
      const selected = await selectProjectExportDirectory(pickerId);
      if (selected) {
        setHasProjectExportFolder(true);
      }
    } catch (error: any) {
      alert(error?.message || '设置导出目录失败。');
    } finally {
      setIsExportMenuOpen(false);
    }
  };

  const loadGlobalInteractionProject = async (target: GlobalInteractionTarget): Promise<ProjectFileResponse> => {
    const response = await fetch(`/api/projects/open?path=${encodeURIComponent(target.projectPath)}`);
    const result = await response.json() as ProjectFileResponse & { error?: string };
    if (!response.ok) {
      throw new Error(result?.error || `读取${target.label}失败`);
    }
    return result;
  };

  const confirmBeforeOpeningGlobalProject = (target: GlobalInteractionTarget) => {
    if (!hasUnsavedChanges && currentProjectPath) return true;

    const lines = [
      '当前项目不会自动保存。',
      `导入到global（${target.label}）后将自动打开${target.label}，当前项目的修改需要你之后手动保存、导出或推送。`
    ];

    if (!currentProjectPath) {
      lines.push('当前项目没有绑定文件路径，请特别注意后续手动导出或推送保存。');
    }

    lines.push('', '是否继续？');
    return window.confirm(lines.join('\n'));
  };

  const handleImportActiveNodeToGlobal = async () => {
    if (!isNonGlobalProject) return;
    const target = getGlobalInteractionTarget(selectedGlobalInteractionTargetId);
    const sourceNode = state.nodes.find((node) => node.id === state.activeNodeId);
    if (!sourceNode) {
      alert('请先在左侧大纲中点击选择一个要导入的节点。');
      return;
    }

    const confirmed = window.confirm(buildImportConfirmationMessage({
      sourceNode,
      descendantCount: countNodeDescendants(state.nodes, sourceNode.id),
      sourceProjectName: state.projectName,
      sourceProjectPath: getProjectPathLabel(currentProjectPath),
      targetProjectName: target.projectName,
      targetProjectPath: target.projectPath
    }));
    if (!confirmed) return;
    if (!confirmBeforeOpeningGlobalProject(target)) return;

    setIsImportingPlanNode(true);
    try {
      const globalProject = await loadGlobalInteractionProject(target);
      const nextGlobalData = cloneSubtreeIntoProject({
        sourceProject: buildProjectData(),
        targetProject: globalProject.projectData,
        sourceNodeId: sourceNode.id
      });
      dispatch({
        type: 'IMPORT_DATA',
        payload: { data: nextGlobalData, projectPath: globalProject.projectPath, markAsUnsaved: true }
      });
      setIsGlobalInteractionMenuOpen(false);
      await loadRecentProjects();
      alert(`已导入到global（${target.label}）：${sourceNode.text || 'Untitled'}。请按需手动保存${target.label}。`);
    } catch (error: any) {
      alert(error?.message || '导入到global失败。');
    } finally {
      setIsImportingPlanNode(false);
    }
  };

  const handleOpenGlobalImportModal = async () => {
    if (!isNonGlobalProject) return;
    const target = getGlobalInteractionTarget(selectedGlobalInteractionTargetId);
    setActiveGlobalImportTargetId(target.id);
    setIsGlobalInteractionMenuOpen(false);
    setIsTaskPlanImportModalOpen(true);
    setTaskPlanImportStatus({ type: 'loading', message: '' });
    setTaskPlanImportData(null);
    setSelectedTaskPlanNodeId(null);

    try {
      const result = await loadGlobalInteractionProject(target);
      setTaskPlanImportData(result.projectData);
      setTaskPlanImportStatus({ type: 'idle', message: '' });
    } catch (error: any) {
      setTaskPlanImportStatus({
        type: 'error',
        message: error?.message || `${target.label}文件不存在或无法读取。`
      });
    }
  };

  const handleImportSelectedTaskPlanNode = async () => {
    if (!isNonGlobalProject || !taskPlanImportData || !selectedTaskPlanNodeId) return;
    const target = getGlobalInteractionTarget(activeGlobalImportTargetId);
    const sourceNode = taskPlanImportData.nodes.find((node) => node.id === selectedTaskPlanNodeId);
    if (!sourceNode) {
      alert(`请先选择一个${target.label}节点。`);
      return;
    }

    const confirmed = window.confirm(buildImportConfirmationMessage({
      sourceNode,
      descendantCount: countNodeDescendants(taskPlanImportData.nodes, sourceNode.id),
      sourceProjectName: taskPlanImportData.projectName || target.projectName,
      sourceProjectPath: target.projectPath,
      targetProjectName: state.projectName,
      targetProjectPath: getProjectPathLabel(currentProjectPath)
    }));
    if (!confirmed) return;

    setIsImportingPlanNode(true);
    try {
      const nextProjectData = cloneSubtreeIntoProject({
        sourceProject: taskPlanImportData,
        targetProject: buildProjectData(),
        sourceNodeId: sourceNode.id
      });
      dispatch({
        type: 'IMPORT_DATA',
        payload: { data: nextProjectData, projectPath: currentProjectPath, markAsUnsaved: true }
      });
      setIsTaskPlanImportModalOpen(false);
      setTaskPlanImportData(null);
      setSelectedTaskPlanNodeId(null);
      await loadRecentProjects();
      alert(`已从global（${target.label}）导入当前项目：${sourceNode.text || 'Untitled'}。请按需手动保存当前项目。`);
    } catch (error: any) {
      alert(error?.message || '从global导入失败。');
    } finally {
      setIsImportingPlanNode(false);
    }
  };

  const getVersionBackupFilename = () => {
      const name = getSafeProjectFilenameBase(state.projectName);
      const dateStr = formatDateForFilename(new Date());
      return `${name}_${dateStr}.json`;
  };

  const handleSaveCurrentVersion = useCallback(async () => {
      dispatch({ type: 'SAVE_VERSION' });
      await downloadJsonDirect(buildProjectData(), getVersionBackupFilename());
      dispatch({ type: 'MARK_VERSION_BACKUP' });
      setLatestProjectStatusEvent('versionBackup');
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
    const confirmed = window.confirm(
      `当前项目名为：${state.projectName || 'Untitled Project'}\n\n覆盖已有项目时，请注意选择正确的文件。`
    );
    if (!confirmed) {
      setIsExportMenuOpen(false);
      return;
    }
    const pickerId = buildProjectExportPickerId(data);
    const canContinue = await ensureProjectExportFolderPrompt(pickerId);
    if (!canContinue) {
      setIsExportMenuOpen(false);
      return;
    }
    const saved = await downloadJson(data, `${getSafeFilename()}.json`, { pickerId });
    if (saved) {
        markProjectExported();
    }
    setIsExportMenuOpen(false);
  };

  const handleExportMarkdown = async () => {
    const data: ProjectData = buildProjectData();
    const confirmed = window.confirm(
      `当前项目名为：${state.projectName || 'Untitled Project'}\n\n覆盖已有项目时，请注意选择正确的文件。`
    );
    if (!confirmed) {
      setIsExportMenuOpen(false);
      return;
    }
    const pickerId = buildProjectExportPickerId(data);
    const canContinue = await ensureProjectExportFolderPrompt(pickerId);
    if (!canContinue) {
      setIsExportMenuOpen(false);
      return;
    }
    const saved = await downloadMarkdown(data, `${getSafeFilename()}.md`, { pickerId });
    if (saved) {
        markProjectExported();
    }
    setIsExportMenuOpen(false);
  };

  const handleOverwriteJson = async () => {
    const data: ProjectData = buildProjectData();
    const pickerId = buildProjectExportPickerId(data);

    try {
      setIsExportMenuOpen(false);
      const targetFile = await selectOverwriteTargetFromExportFolder(pickerId, 'json', 'JSON');
      if (!targetFile) return;

      const canSave = await confirmExportTargetName(targetFile.name, 'json');
      if (!canSave) return;

      await writeFileHandle(targetFile.handle, JSON.stringify(data, null, 2));
      markProjectExported();
    } catch (error: any) {
      alert(error?.message || '覆盖 JSON 文件失败。');
    } finally {
      setIsExportMenuOpen(false);
    }
  };

  const handleOverwriteMarkdown = async () => {
    const data: ProjectData = buildProjectData();
    const pickerId = buildProjectExportPickerId(data);

    try {
      setIsExportMenuOpen(false);
      const targetFile = await selectOverwriteTargetFromExportFolder(pickerId, 'md', 'Markdown');
      if (!targetFile) return;

      const canSave = await confirmExportTargetName(targetFile.name, 'md');
      if (!canSave) return;

      await writeFileHandle(targetFile.handle, buildMarkdownExport(data));
      markProjectExported();
    } catch (error: any) {
      alert(error?.message || '覆盖 Markdown 文件失败。');
    } finally {
      setIsExportMenuOpen(false);
    }
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
        setLatestProjectStatusEvent('githubPushed');
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

  const globalRecentProjects = recentProjects.filter((project) => project.isGlobal);
  const githubBackupProjects = recentProjects.filter((project) => !project.isGlobal);

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
                                        <div className="text-xs text-gray-500 dark:text-gray-400">global、最近导入与 GitHub 项目分组展示</div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            void loadRecentProjects();
                                            void refreshRecentImportedProjects();
                                        }}
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
                                        <div className="mt-2 text-xs text-red-500/80 dark:text-red-300/80">当前项目仍可继续编辑；恢复本地项目服务后即可使用 global 和 GitHub 项目入口。</div>
                                    </div>
                                )}

                                {recentProjectsStatus.type !== 'loading' && recentProjectsStatus.type !== 'error' && globalRecentProjects.length > 0 && (
                                    <>
                                        <div className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500">Global</div>
                                        {globalRecentProjects.map((project) => (
                                            <button
                                                key={project.relativePath}
                                                onClick={() => void handleOpenRecentProject(project)}
                                                disabled={isOpeningRecentProject !== null}
                                                className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[color:var(--flow-accent-soft)] disabled:cursor-wait disabled:opacity-70 dark:hover:bg-zinc-800"
                                            >
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="rounded-full bg-[color:var(--flow-accent-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--flow-accent)] dark:bg-[color:var(--flow-accent-soft)] dark:text-[color:var(--flow-accent)]">
                                                            全局
                                                        </span>
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
                                    </>
                                )}

                                <div className="border-t border-gray-100 px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:border-zinc-800 dark:text-zinc-500">最近本地项目</div>
                                {recentImportedProjects.length === 0 ? (
                                    <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">还没有通过 Import JSON 打开的本地项目。</div>
                                ) : (
                                    recentImportedProjects.map((project) => (
                                        <button
                                            key={project.id}
                                            onClick={() => void handleRecentImportedProjectClick(project)}
                                            disabled={isOpeningRecentImportedProjectId !== null}
                                            className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[color:var(--flow-accent-soft)] disabled:cursor-wait disabled:opacity-70 dark:hover:bg-zinc-800"
                                            title={`${project.projectName}\n${project.fileName}`}
                                        >
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                                                    {project.projectName || project.fileName}
                                                </div>
                                                <div className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                                                    {project.fileName}
                                                </div>
                                            </div>
                                            <div className="shrink-0 text-right text-[11px] text-gray-400 dark:text-gray-500">
                                                {isOpeningRecentImportedProjectId === project.id ? '打开中...' : formatCompactDateTime(project.importedAt)}
                                            </div>
                                        </button>
                                    ))
                                )}

                                {recentProjectsStatus.type !== 'loading' && recentProjectsStatus.type !== 'error' && (
                                    <div className="border-t border-gray-100 dark:border-zinc-800">
                                        <button
                                            type="button"
                                            onClick={() => setIsGithubProjectsListOpen((open) => !open)}
                                            className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-gray-800 transition-colors hover:bg-[color:var(--flow-accent-soft)] dark:text-gray-100 dark:hover:bg-zinc-800"
                                        >
                                            <span>GitHub 项目列表</span>
                                            <span className="flex items-center gap-2 text-xs text-gray-400 dark:text-zinc-500">
                                                {githubBackupProjects.length} 个
                                                <IconChevronDown className={`h-3.5 w-3.5 transition-transform ${isGithubProjectsListOpen ? 'rotate-180' : ''}`} />
                                            </span>
                                        </button>

                                        {isGithubProjectsListOpen && (
                                            githubBackupProjects.length === 0 ? (
                                                <div className="px-4 pb-4 text-sm text-gray-500 dark:text-gray-400">暂无已推送到 GitHub 的项目记录。</div>
                                            ) : (
                                                githubBackupProjects.map((project) => (
                                                    <button
                                                        key={project.relativePath}
                                                        onClick={() => void handleOpenRecentProject(project)}
                                                        disabled={isOpeningRecentProject !== null}
                                                        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[color:var(--flow-accent-soft)] disabled:cursor-wait disabled:opacity-70 dark:hover:bg-zinc-800"
                                                    >
                                                        <div className="min-w-0">
                                                            <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                                                                {project.displayName}
                                                            </div>
                                                            <div className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                                                                {project.relativePath}
                                                            </div>
                                                        </div>
                                                        <div className="shrink-0 text-right text-[11px] text-gray-400 dark:text-gray-500">
                                                            {isOpeningRecentProject === project.relativePath ? '打开中...' : new Date(project.modifiedAt).toLocaleString('zh-CN', { hour12: false })}
                                                        </div>
                                                    </button>
                                                ))
                                            )
                                        )}
                                    </div>
                                )}
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
                            className={`w-2 h-2 rounded-full flex-shrink-0 ${projectStatusIndicator.className}`} 
                            title={projectStatusIndicator.title}
                        />
                        {isNonGlobalProject && (
                            <div className="relative ml-1" ref={globalInteractionMenuRef}>
                                <button
                                    type="button"
                                    onClick={() => setIsGlobalInteractionMenuOpen((open) => !open)}
                                    disabled={isImportingPlanNode}
                                    className={`flex items-center gap-1 rounded-md border border-gray-200 px-2 py-0.5 text-[10px] font-medium transition-colors disabled:cursor-wait disabled:opacity-70 dark:border-zinc-700 ${
                                        isGlobalInteractionMenuOpen
                                            ? 'bg-[color:var(--flow-accent-soft)] text-[color:var(--flow-accent)] dark:bg-zinc-800'
                                            : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-zinc-800'
                                    }`}
                                    title="与 global 文件进行节点导入"
                                >
                                    <span>{isImportingPlanNode ? '处理中...' : 'global交互'}</span>
                                    <IconChevronDown className={`h-3 w-3 transition-transform ${isGlobalInteractionMenuOpen ? 'rotate-180' : ''}`} />
                                </button>

                                {isGlobalInteractionMenuOpen && (
                                    <div className="absolute left-0 z-50 mt-2 w-56 rounded-lg border border-[color:var(--flow-accent-border)]/70 bg-white shadow-xl dark:border-[color:var(--flow-accent-border)] dark:bg-zinc-900">
                                        <div className="border-b border-gray-100 px-3 py-3 dark:border-zinc-800">
                                            <label htmlFor="global-interaction-target" className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                                                global文件
                                            </label>
                                            <select
                                                id="global-interaction-target"
                                                value={selectedGlobalInteractionTargetId}
                                                onChange={(event) => setSelectedGlobalInteractionTargetId(event.target.value as GlobalInteractionTargetId)}
                                                disabled={isImportingPlanNode}
                                                className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-800 outline-none transition-colors focus:border-[color:var(--flow-accent-border)] dark:border-zinc-700 dark:bg-zinc-950 dark:text-gray-100"
                                            >
                                                {GLOBAL_INTERACTION_TARGETS.map((target) => (
                                                    <option key={target.id} value={target.id}>{target.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="space-y-1 p-2">
                                            <button
                                                type="button"
                                                onClick={() => void handleImportActiveNodeToGlobal()}
                                                disabled={isImportingPlanNode}
                                                className="block w-full rounded-md px-3 py-2 text-left text-sm text-[color:var(--flow-accent-muted)] transition-colors hover:bg-[color:var(--flow-accent-soft)] hover:text-[color:var(--flow-accent)] disabled:cursor-wait disabled:opacity-60 dark:text-gray-200 dark:hover:bg-zinc-800 dark:hover:text-[color:var(--flow-accent)]"
                                            >
                                                导入到global
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => void handleOpenGlobalImportModal()}
                                                disabled={isImportingPlanNode}
                                                className="block w-full rounded-md px-3 py-2 text-left text-sm text-[color:var(--flow-accent-muted)] transition-colors hover:bg-[color:var(--flow-accent-soft)] hover:text-[color:var(--flow-accent)] disabled:cursor-wait disabled:opacity-60 dark:text-gray-200 dark:hover:bg-zinc-800 dark:hover:text-[color:var(--flow-accent)]"
                                            >
                                                从global导入
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
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
                                {isTodayTodoProject && (
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
                                onClick={() => dispatch({ type: 'SET_LAYOUT_MODE', payload: 'dual' })}
                                className={`p-1.5 rounded-md ${state.layoutMode === 'dual' ? 'bg-white shadow text-[color:var(--flow-accent)] dark:bg-zinc-700 dark:text-[color:var(--flow-accent)]' : 'text-[color:var(--flow-accent-muted)] hover:text-[color:var(--flow-accent)] hover:bg-[color:var(--flow-accent-soft)] dark:text-[color:var(--flow-accent-muted)] dark:hover:text-[color:var(--flow-accent)]'}`}
                                title="Dual editor view"
                            >
                                <IconViewSplit className="w-4 h-4" />
                            </button>
                            {state.layoutMode === 'dual' && (
                                <>
                                    <div className="w-px h-4 bg-gray-200 dark:bg-zinc-700 mx-1"></div>
                                    <button
                                        onClick={() => dispatch({ type: 'SET_DUAL_DETAIL_LAYOUT', payload: 'side-by-side' })}
                                        className={`p-1.5 rounded-md ${state.dualDetailLayout === 'side-by-side' ? 'bg-white shadow text-[color:var(--flow-accent)] dark:bg-zinc-700 dark:text-[color:var(--flow-accent)]' : 'text-[color:var(--flow-accent-muted)] hover:text-[color:var(--flow-accent)] hover:bg-[color:var(--flow-accent-soft)] dark:text-[color:var(--flow-accent-muted)] dark:hover:text-[color:var(--flow-accent)]'}`}
                                        title="Dual editors side-by-side"
                                    >
                                        <IconLayoutHorizontal className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => dispatch({ type: 'SET_DUAL_DETAIL_LAYOUT', payload: 'stacked' })}
                                        className={`p-1.5 rounded-md ${state.dualDetailLayout === 'stacked' ? 'bg-white shadow text-[color:var(--flow-accent)] dark:bg-zinc-700 dark:text-[color:var(--flow-accent)]' : 'text-[color:var(--flow-accent-muted)] hover:text-[color:var(--flow-accent)] hover:bg-[color:var(--flow-accent-soft)] dark:text-[color:var(--flow-accent-muted)] dark:hover:text-[color:var(--flow-accent)]'}`}
                                        title="Dual editors stacked"
                                    >
                                        <IconViewSplit className="w-4 h-4 rotate-90" />
                                    </button>
                                </>
                            )}
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

                <div className="relative" ref={importMenuRef}>
                    <button
                        onClick={() => setIsImportMenuOpen(!isImportMenuOpen)}
                        className={`flex items-center gap-1 p-2 rounded-lg transition-colors ${isImportMenuOpen ? 'bg-[color:var(--flow-accent-soft)] text-[color:var(--flow-accent)] dark:bg-zinc-800 dark:text-[color:var(--flow-accent)]' : 'text-[color:var(--flow-accent-muted)] hover:bg-[color:var(--flow-accent-soft)] hover:text-[color:var(--flow-accent)] dark:text-[color:var(--flow-accent-muted)] dark:hover:bg-zinc-800 dark:hover:text-[color:var(--flow-accent)]'}`}
                        title="Import"
                    >
                        <IconUpload className="w-4 h-4" />
                        <IconChevronDown className="w-3 h-3" />
                    </button>
                    {isImportMenuOpen && (
                        <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-zinc-800 rounded-md shadow-lg py-1 border border-[color:var(--flow-accent-border)]/70 dark:border-[color:var(--flow-accent-border)] z-50">
                            <button
                                onClick={() => void handleImportProjectJsonClick()}
                                className="block w-full text-left px-4 py-2 text-sm text-[color:var(--flow-accent-muted)] dark:text-gray-200 hover:bg-[color:var(--flow-accent-soft)] hover:text-[color:var(--flow-accent)] dark:hover:bg-zinc-700 dark:hover:text-[color:var(--flow-accent)]"
                            >
                                Import JSON (Overwrite Project)
                            </button>
                            <button
                                onClick={() => {
                                    setIsImportMenuOpen(false);
                                    importProjectAsNodeInputRef.current?.click();
                                }}
                                className="block w-full text-left px-4 py-2 text-sm text-[color:var(--flow-accent-muted)] dark:text-gray-200 hover:bg-[color:var(--flow-accent-soft)] hover:text-[color:var(--flow-accent)] dark:hover:bg-zinc-700 dark:hover:text-[color:var(--flow-accent)]"
                            >
                                Import Project as Node
                            </button>
                        </div>
                    )}
                </div>
                <input type="file" ref={fileInputRef} onChange={handleImport} accept=".json" className="hidden" />
                <input type="file" ref={importProjectAsNodeInputRef} onChange={handleImportProjectAsNode} accept=".json" className="hidden" />

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
                        <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-zinc-800 rounded-md shadow-lg py-1 border border-[color:var(--flow-accent-border)]/70 dark:border-[color:var(--flow-accent-border)] z-50">
                            <button onClick={handleExportJson} className="block w-full text-left px-4 py-2 text-sm text-[color:var(--flow-accent-muted)] dark:text-gray-200 hover:bg-[color:var(--flow-accent-soft)] hover:text-[color:var(--flow-accent)] dark:hover:bg-zinc-700 dark:hover:text-[color:var(--flow-accent)]">Export as JSON</button>
                            <button onClick={handleExportMarkdown} className="block w-full text-left px-4 py-2 text-sm text-[color:var(--flow-accent-muted)] dark:text-gray-200 hover:bg-[color:var(--flow-accent-soft)] hover:text-[color:var(--flow-accent)] dark:hover:bg-zinc-700 dark:hover:text-[color:var(--flow-accent)]">Export as Markdown</button>
                            <div className="my-1 border-t border-gray-100 dark:border-zinc-700" />
                            <button onClick={handleOverwriteJson} className="block w-full text-left px-4 py-2 text-sm text-[color:var(--flow-accent-muted)] dark:text-gray-200 hover:bg-[color:var(--flow-accent-soft)] hover:text-[color:var(--flow-accent)] dark:hover:bg-zinc-700 dark:hover:text-[color:var(--flow-accent)]">Overwrite JSON File</button>
                            <button onClick={handleOverwriteMarkdown} className="block w-full text-left px-4 py-2 text-sm text-[color:var(--flow-accent-muted)] dark:text-gray-200 hover:bg-[color:var(--flow-accent-soft)] hover:text-[color:var(--flow-accent)] dark:hover:bg-zinc-700 dark:hover:text-[color:var(--flow-accent)]">Overwrite Markdown File</button>
                            <div className="my-1 border-t border-gray-100 dark:border-zinc-700" />
                            <button onClick={handleSetProjectExportFolder} className="block w-full text-left px-4 py-2 text-sm text-[color:var(--flow-accent-muted)] dark:text-gray-200 hover:bg-[color:var(--flow-accent-soft)] hover:text-[color:var(--flow-accent)] dark:hover:bg-zinc-700 dark:hover:text-[color:var(--flow-accent)]">{hasProjectExportFolder ? 'Reset Export Folder' : 'Set Export Folder'}</button>
                            <div className="my-1 border-t border-gray-100 dark:border-zinc-700" />
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
                        <FocusArea
                            outlineStyle={outlineStyle}
                            onToggleOutlineStyle={() => setOutlineStyle((style) => style === 'classic' ? 'minimal' : 'classic')}
                            onOpenMindFlow={() => setIsMindFlowOpen(true)}
                        />
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
                            split="vertical"
                            initialSize="30%"
                        >
                            <FocusArea
                                outlineStyle={outlineStyle}
                                onToggleOutlineStyle={() => setOutlineStyle((style) => style === 'classic' ? 'minimal' : 'classic')}
                                onOpenMindFlow={() => setIsMindFlowOpen(true)}
                            />
                            {state.layoutMode === 'dual' ? <DualDetailArea /> : <DetailArea />}
                        </SplitPane>
                    ) : viewMode === 'outline' ? (
                         // Outline Only: Show FocusArea full width
                        <div className="h-full w-full bg-white/62 dark:bg-zinc-950/62">
                            <FocusArea
                                outlineStyle={outlineStyle}
                                onToggleOutlineStyle={() => setOutlineStyle((style) => style === 'classic' ? 'minimal' : 'classic')}
                                onOpenMindFlow={() => setIsMindFlowOpen(true)}
                            />
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

        <MindFlowWindow isOpen={isMindFlowOpen} onClose={() => setIsMindFlowOpen(false)} />
        <StatsModal />
        <VersionsModal
            onSaveCurrentVersion={handleSaveCurrentVersion}
            gitHistoryConfig={{
                repoUrl: gitRepoUrl,
                projectName: state.projectName,
                projectPath: getGithubHistoryProjectPath(),
                proxyEnabled,
                httpProxy,
                httpsProxy
            }}
            hasUnsavedChanges={hasUnsavedChanges}
            onRestoreGithubVersion={handleRestoreGithubVersion}
        />
        <TaskPlanImportModal
            isOpen={isTaskPlanImportModalOpen}
            sourceLabel={getGlobalInteractionTarget(activeGlobalImportTargetId).label}
            sourcePath={getGlobalInteractionTarget(activeGlobalImportTargetId).projectPath}
            taskPlanData={taskPlanImportData}
            selectedNodeId={selectedTaskPlanNodeId}
            status={taskPlanImportStatus}
            isImporting={isImportingPlanNode}
            onSelectNode={setSelectedTaskPlanNodeId}
            onConfirm={() => void handleImportSelectedTaskPlanNode()}
            onClose={() => {
                if (isImportingPlanNode) return;
                setIsTaskPlanImportModalOpen(false);
            }}
        />
        {overwriteFilePicker && (
            <div
                className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4"
                onClick={() => resolveOverwriteFilePicker(null)}
            >
                <div
                    className="w-full max-w-lg rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
                    onClick={(e) => e.stopPropagation()}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="overwrite-file-picker-title"
                >
                    <div className="border-b border-gray-200 px-5 py-4 dark:border-zinc-700">
                        <h3 id="overwrite-file-picker-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                            {overwriteFilePicker.title}
                        </h3>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                            {overwriteFilePicker.description}
                        </p>
                    </div>
                    <div className="max-h-80 overflow-y-auto px-2 py-2">
                        {overwriteFilePicker.files.map((file) => (
                            <button
                                key={file.name}
                                onClick={() => resolveOverwriteFilePicker(file)}
                                className="block w-full rounded-lg px-3 py-2 text-left text-sm text-gray-800 hover:bg-[color:var(--flow-accent-soft)] hover:text-[color:var(--flow-accent)] dark:text-gray-100 dark:hover:bg-zinc-800"
                            >
                                <span className="block break-all font-medium">{file.name}</span>
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center justify-end border-t border-gray-200 px-5 py-4 dark:border-zinc-700">
                        <button
                            onClick={() => resolveOverwriteFilePicker(null)}
                            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:border-zinc-600 dark:text-gray-200 dark:hover:bg-zinc-800"
                        >
                            取消
                        </button>
                    </div>
                </div>
            </div>
        )}
        {isExportFolderNoticeOpen && (
            <div
                className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4"
                onClick={() => resolveExportFolderNotice(false)}
            >
                <div
                    className="w-full max-w-lg rounded-xl border border-amber-200 bg-white shadow-2xl dark:border-amber-900/60 dark:bg-zinc-900"
                    onClick={(e) => e.stopPropagation()}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="export-folder-notice-title"
                >
                    <div className="border-b border-amber-100 px-5 py-4 dark:border-amber-900/50">
                        <h3 id="export-folder-notice-title" className="text-lg font-semibold text-amber-700 dark:text-amber-300">
                            导出目录未设置
                        </h3>
                    </div>
                    <div className="px-5 py-4 text-sm text-gray-700 dark:text-gray-200">
                        当前项目尚未设置导出目录，建议先在 Export 菜单中点击 Set Export Folder 进行设置。
                        若继续导出，本次将使用默认文件选择逻辑。
                    </div>
                    <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-4 dark:border-zinc-700">
                        <button
                            onClick={() => resolveExportFolderNotice(false)}
                            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:border-zinc-600 dark:text-gray-200 dark:hover:bg-zinc-800"
                        >
                            取消
                        </button>
                        <button
                            onClick={() => resolveExportFolderNotice(true)}
                            className="rounded-lg bg-[color:var(--flow-accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[color:var(--flow-accent-strong)]"
                        >
                            继续导出
                        </button>
                    </div>
                </div>
            </div>
        )}
        {overwriteRiskConfirm && (
            <div
                className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4"
                onClick={() => resolveOverwriteRiskConfirm(false)}
            >
                <div
                    className="w-full max-w-xl rounded-xl border border-red-200 bg-white shadow-2xl dark:border-red-900/60 dark:bg-zinc-900"
                    onClick={(e) => e.stopPropagation()}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="overwrite-risk-title"
                >
                    <div className="border-b border-red-100 px-5 py-4 dark:border-red-900/50">
                        <h3 id="overwrite-risk-title" className="text-lg font-semibold text-red-700 dark:text-red-300">
                            高风险覆盖确认
                        </h3>
                    </div>
                    <div className="space-y-4 px-5 py-4 text-sm text-gray-700 dark:text-gray-200">
                        <div className="grid gap-3 sm:grid-cols-[104px_1fr]">
                            <div className="font-medium text-gray-500 dark:text-gray-400">当前项目</div>
                            <div className="break-all rounded-md bg-gray-50 px-3 py-2 font-medium text-gray-900 dark:bg-zinc-800 dark:text-gray-100">
                                {overwriteRiskConfirm.expectedPrefix}
                            </div>
                            <div className="font-medium text-gray-500 dark:text-gray-400">覆盖文件</div>
                            <div className="break-all rounded-md bg-red-50 px-3 py-2 font-medium text-red-800 dark:bg-red-950/30 dark:text-red-200">
                                {overwriteRiskConfirm.targetFilename}
                            </div>
                            <div className="font-medium text-gray-500 dark:text-gray-400">识别项目</div>
                            <div className="break-all rounded-md bg-gray-50 px-3 py-2 font-medium text-gray-900 dark:bg-zinc-800 dark:text-gray-100">
                                {overwriteRiskConfirm.actualPrefix}
                            </div>
                        </div>
                        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                            继续操作会用当前项目内容覆盖该文件。如果你只是想导出新副本，请取消并使用 Export。
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            取消不会修改目标文件；继续覆盖会写入当前项目内容。
                        </p>
                    </div>
                    <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-4 dark:border-zinc-700">
                        <button
                            onClick={() => resolveOverwriteRiskConfirm(false)}
                            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:border-zinc-600 dark:text-gray-200 dark:hover:bg-zinc-800"
                        >
                            取消，不覆盖
                        </button>
                        <button
                            onClick={() => resolveOverwriteRiskConfirm(true)}
                            className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
                        >
                            继续覆盖
                        </button>
                    </div>
                </div>
            </div>
        )}
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
