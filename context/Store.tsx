import React, { createContext, useContext, useReducer, useEffect } from 'react';
import { LogNode, ContentMap, ProjectData, VersionEntry, NodeStatus, LayoutMode, OutlineMode, ViewMode, BackgroundPreset, NodeClipboard } from '../types';
import { generateId } from '../utils/helpers';

// --- State Definition ---
interface State {
  projectName: string; 
  nodes: LogNode[];
  contentMap: ContentMap;
  nodeClipboard: NodeClipboard | null;
  activeNodeId: string | null;
  focusedNodeId: string | null; // New: For Focus Mode
  currentProjectPath: string | null;
  versions: VersionEntry[];
  layoutMode: LayoutMode;
  metadata: {
    version: string;
    createdAt: string;
    lastModified: string;
    lastExported?: string;
    lastVersionBackupAt?: string;
  };
  ui: {
    isMobile: boolean;
    showStats: boolean;
    showVersions: boolean;
    viewMode: ViewMode;
    showOutlineDetails: boolean;
    theme: 'light' | 'dark';
    backgroundPreset: BackgroundPreset;
    showNodeLastModified: boolean;
    outlineMode: OutlineMode;
    hideOnHold: boolean;
    showFocusedRoot: boolean;
    useNodeTemplate: boolean;
    autoBackupOnSaveVersion: boolean;
  };
}

const STORAGE_KEY = 'flow-data';
const MOBILE_THRESHOLD = 768; 
const DEFAULT_PROJECT_NAME = 'Untitled Project';
const MAX_VERSIONS = 3;
const EMPTY_NODE_CONTENT = '# \n\n';
const TASK_PLAN_PROJECT_PATH = 'global/任务计划.json';
const NEW_NODE_BODY_TEMPLATE = [
  '### 问题/情景',
  '### 原因/假设',
  '### 目标',
  '### 解决方案/行动',
  '### 结果',
  '### 下一步计划'
].join('\n');

const resolveFocusedNodeId = (nodes: LogNode[], focusedNodeId?: string | null): string | null => {
  if (!focusedNodeId) return null;
  return nodes.some(node => node.id === focusedNodeId) ? focusedNodeId : null;
};

const resolveActiveNodeId = (nodes: LogNode[], activeNodeId?: string | null): string | null => {
  if (!nodes.length) return null;
  if (!activeNodeId) return nodes[0].id;
  return nodes.some(node => node.id === activeNodeId) ? activeNodeId : nodes[0].id;
};

const getTodayDateString = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const isTaskPlanProject = (projectPath?: string | null) => projectPath === TASK_PLAN_PROJECT_PATH;

const buildNodeContent = (title: string, desc = '', body = '') => {
  const formattedTitle = `# ${title}`;
  const formattedDesc = desc ? `> ${desc}` : '';
  return `${formattedTitle}\n${formattedDesc}\n${body}`;
};

const buildProjectData = (state: State): ProjectData => ({
  projectName: state.projectName,
  nodes: state.nodes,
  contentMap: state.contentMap,
  activeNodeId: state.activeNodeId,
  focusedNodeId: state.focusedNodeId,
  currentProjectPath: state.currentProjectPath,
  layoutMode: state.layoutMode,
  metadata: state.metadata,
  ui: {
    viewMode: state.ui.viewMode,
    showOutlineDetails: state.ui.showOutlineDetails,
    theme: state.ui.theme,
    backgroundPreset: state.ui.backgroundPreset,
    showNodeLastModified: state.ui.showNodeLastModified,
    outlineMode: state.ui.outlineMode,
    hideOnHold: state.ui.hideOnHold,
    showFocusedRoot: state.ui.showFocusedRoot,
    useNodeTemplate: state.ui.useNodeTemplate,
    autoBackupOnSaveVersion: state.ui.autoBackupOnSaveVersion
  }
});

const getSubtreeRange = (nodes: LogNode[], startIndex: number) => {
  const rootNode = nodes[startIndex];
  let endIndex = startIndex + 1;

  while (endIndex < nodes.length && nodes[endIndex].depth > rootNode.depth) {
    endIndex++;
  }

  return { rootNode, endIndex };
};

const cloneSubtreeToClipboard = (
  nodes: LogNode[],
  contentMap: ContentMap,
  startIndex: number
): NodeClipboard => {
  const { rootNode, endIndex } = getSubtreeRange(nodes, startIndex);
  const subtreeNodes = nodes.slice(startIndex, endIndex);

  return {
    nodes: subtreeNodes.map(node => ({
      ...node,
      depth: node.depth - rootNode.depth
    })),
    contentMap: subtreeNodes.reduce<ContentMap>((acc, node) => {
      acc[node.id] = contentMap[node.id] || '';
      return acc;
    }, {})
  };
};

const pasteClipboardSubtree = (
  nodes: LogNode[],
  contentMap: ContentMap,
  clipboard: NodeClipboard,
  targetIndex: number,
  timestamp: string
) => {
  const { rootNode: targetNode, endIndex } = getSubtreeRange(nodes, targetIndex);
  const idMap = new Map<string, string>();

  const pastedNodes = clipboard.nodes.map(node => {
    const newId = generateId();
    idMap.set(node.id, newId);
    return {
      ...node,
      id: newId,
      depth: targetNode.depth + node.depth,
      lastModified: timestamp
    };
  });

  const normalizedPastedNodes = pastedNodes.map((node, index) => {
    const sourceNodeId = clipboard.nodes[index].sourceNodeId;
    return {
      ...node,
      sourceNodeId: sourceNodeId ? idMap.get(sourceNodeId) || sourceNodeId : undefined
    };
  });

  const pastedContentMap = normalizedPastedNodes.reduce<ContentMap>((acc, node, index) => {
    const sourceNode = clipboard.nodes[index];
    acc[node.id] = clipboard.contentMap[sourceNode.id] || '';
    return acc;
  }, {});

  const nextNodes = [...nodes];
  nextNodes.splice(endIndex, 0, ...normalizedPastedNodes);

  return {
    nodes: nextNodes,
    contentMap: {
      ...contentMap,
      ...pastedContentMap
    },
    activeNodeId: normalizedPastedNodes[0]?.id || targetNode.id
  };
};

// Helper to create a fresh state object
const createEmptyState = (isMobile: boolean): State => {
  const rootId = generateId();
  const now = new Date().toISOString();
  
  return {
    projectName: DEFAULT_PROJECT_NAME,
    nodes: [
      { id: rootId, text: '', desc: '', status: 'waiting', depth: 0, collapsed: false, order: 0, lastModified: now },
    ],
    contentMap: {
      'root': '', 
      [rootId]: EMPTY_NODE_CONTENT
    },
    nodeClipboard: null,
    activeNodeId: rootId,
    focusedNodeId: null,
    currentProjectPath: null,
    versions: [],
    layoutMode: 'horizontal',
    metadata: {
      version: '2.0.0',
      createdAt: now,
      lastModified: now,
      lastExported: now,
    },
    ui: {
      isMobile: isMobile,
      showStats: false,
      showVersions: false,
      viewMode: 'split',
      showOutlineDetails: true,
      theme: 'light',
      backgroundPreset: 'default',
      showNodeLastModified: false,
      outlineMode: 'tree',
      hideOnHold: false,
      showFocusedRoot: false,
      useNodeTemplate: true,
      autoBackupOnSaveVersion: false
    }
  };
};

const getInitialState = (): State => {
  const stored = localStorage.getItem(STORAGE_KEY);
  const now = new Date().toISOString();
  
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      
      let initialViewMode: ViewMode = 'split';
      if (parsed.ui?.viewMode) {
          initialViewMode = parsed.ui.viewMode;
      } else if (parsed.ui?.sidebarVisible === false) {
          initialViewMode = 'editor';
      }

      const nodes: LogNode[] = parsed.nodes.map((n: any) => ({ 
        ...n, 
        desc: n.desc || '',
        lastModified: n.lastModified || parsed.metadata?.lastModified || now
      }));
      const activeNodeId = resolveActiveNodeId(nodes, parsed.activeNodeId);
      const focusedNodeId = resolveFocusedNodeId(nodes, parsed.focusedNodeId);

      return {
        ...parsed,
        projectName: parsed.projectName || DEFAULT_PROJECT_NAME,
        nodes,
        nodeClipboard: null,
        activeNodeId,
        focusedNodeId,
        currentProjectPath: parsed.currentProjectPath || null,
        versions: parsed.versions || [],
        layoutMode: parsed.layoutMode || 'horizontal',
        ui: { 
            isMobile: window.innerWidth < MOBILE_THRESHOLD, 
            showStats: false,
            showVersions: false,
            viewMode: initialViewMode,
            showOutlineDetails: parsed.ui?.showOutlineDetails ?? true,
            theme: parsed.ui?.theme || 'light',
            backgroundPreset: parsed.ui?.backgroundPreset || 'default',
            showNodeLastModified: parsed.ui?.showNodeLastModified ?? false,
            outlineMode: parsed.ui?.outlineMode || 'tree',
            hideOnHold: parsed.ui?.hideOnHold ?? false,
            showFocusedRoot: parsed.ui?.showFocusedRoot ?? false,
            useNodeTemplate: parsed.ui?.useNodeTemplate ?? true,
            autoBackupOnSaveVersion: parsed.ui?.autoBackupOnSaveVersion ?? false
        },
        contentMap: { ...parsed.contentMap, root: parsed.contentMap.root || '' },
        metadata: {
            ...parsed.metadata,
            lastExported: parsed.metadata?.lastExported || parsed.metadata?.createdAt || now,
            lastVersionBackupAt: parsed.metadata?.lastVersionBackupAt
        }
      };
    } catch (e) {
      console.error("Failed to load local storage", e);
    }
  }

  return createEmptyState(window.innerWidth < MOBILE_THRESHOLD);
};

// --- Actions ---
type Action =
  | { type: 'SET_ACTIVE_NODE'; payload: string }
  | { type: 'SET_FOCUSED_NODE'; payload: string | null }
  | { type: 'COPY_NODE_SUBTREE'; payload: string }
  | { type: 'PASTE_NODE_SUBTREE'; payload: string }
  | { type: 'UPDATE_PROJECT_NAME'; payload: string }
  | { type: 'UPDATE_NODE_META'; payload: { id: string; text?: string; desc?: string } }
  | { type: 'UPDATE_CONTENT'; payload: { id: string; content: string } }
  | { type: 'SET_STATUS'; payload: { id: string; status: NodeStatus } }
  | { type: 'TOGGLE_COLLAPSE'; payload: string }
  | { type: 'INSERT_NODE'; payload: { targetId: string; position: 'before' | 'after' } }
  | { type: 'DELETE_NODE'; payload: { id: string; includeDescendants: boolean } }
  | { type: 'INDENT_NODE'; payload: string }
  | { type: 'INDENT_SUBTREE'; payload: string }
  | { type: 'OUTDENT_NODE'; payload: string }
  | { type: 'MOVE_NODE'; payload: { sourceId: string; targetId: string; position: 'top' | 'bottom' } }
  | { type: 'EXTRACT_PROJECT'; payload: string }
  | { type: 'IMPORT_DATA'; payload: { data: ProjectData; projectPath?: string | null } }
  | { type: 'RESET_PROJECT' }
  | { type: 'SET_MOBILE'; payload: boolean }
  | { type: 'TOGGLE_STATS'; payload: boolean }
  | { type: 'TOGGLE_VERSIONS'; payload: boolean }
  | { type: 'SET_VIEW_MODE'; payload: ViewMode }
  | { type: 'TOGGLE_OUTLINE_DETAILS'; payload?: boolean }
  | { type: 'TOGGLE_THEME' }
  | { type: 'SET_BACKGROUND_PRESET'; payload: BackgroundPreset }
  | { type: 'TOGGLE_NODE_LAST_MODIFIED'; payload?: boolean }
  | { type: 'TOGGLE_OUTLINE_MODE' }
  | { type: 'TOGGLE_HIDE_ON_HOLD'; payload?: boolean }
  | { type: 'TOGGLE_ROOT_FOCUS_VIEW'; payload?: boolean }
  | { type: 'TOGGLE_NODE_TEMPLATE'; payload?: boolean }
  | { type: 'TOGGLE_AUTO_BACKUP_ON_SAVE_VERSION'; payload?: boolean }
  | { type: 'SET_LAYOUT_MODE'; payload: LayoutMode }
  | { type: 'UPDATE_LAST_EXPORTED' }
  | { type: 'MARK_VERSION_BACKUP' }
  | { type: 'SAVE_VERSION' }
  | { type: 'ROLLBACK_VERSION'; payload: string };

const reducer = (state: State, action: Action): State => {
  const now = new Date().toISOString();
  
  switch (action.type) {
    case 'SET_ACTIVE_NODE':
      return { ...state, activeNodeId: action.payload };

    case 'SET_FOCUSED_NODE':
      return { ...state, focusedNodeId: action.payload };

    case 'COPY_NODE_SUBTREE': {
      const startIndex = state.nodes.findIndex(node => node.id === action.payload);
      if (startIndex === -1) return state;

      return {
        ...state,
        nodeClipboard: cloneSubtreeToClipboard(state.nodes, state.contentMap, startIndex)
      };
    }

    case 'PASTE_NODE_SUBTREE': {
      if (!state.nodeClipboard) return state;

      const targetIndex = state.nodes.findIndex(node => node.id === action.payload);
      if (targetIndex === -1) return state;

      const pasted = pasteClipboardSubtree(
        state.nodes,
        state.contentMap,
        state.nodeClipboard,
        targetIndex,
        now
      );

      return {
        ...state,
        nodes: pasted.nodes,
        contentMap: pasted.contentMap,
        activeNodeId: pasted.activeNodeId,
        metadata: { ...state.metadata, lastModified: now }
      };
    }

    case 'UPDATE_PROJECT_NAME':
      return { 
          ...state, 
          projectName: action.payload,
          metadata: { ...state.metadata, lastModified: now }
      };

    case 'SET_LAYOUT_MODE':
      return { ...state, layoutMode: action.payload };

    case 'UPDATE_NODE_META':
      return {
        ...state,
        nodes: state.nodes.map(n => n.id === action.payload.id ? { 
            ...n, 
            text: action.payload.text !== undefined ? action.payload.text : n.text,
            desc: action.payload.desc !== undefined ? action.payload.desc : n.desc,
            lastModified: now
        } : n),
        metadata: { ...state.metadata, lastModified: now }
      };

    case 'UPDATE_CONTENT': {
      const updatedNodes = state.nodes.map(n => 
          n.id === action.payload.id ? { ...n, lastModified: now } : n
      );

      return {
        ...state,
        nodes: updatedNodes,
        contentMap: { ...state.contentMap, [action.payload.id]: action.payload.content },
        metadata: { ...state.metadata, lastModified: now }
      };
    }

    case 'SET_STATUS':
      return {
        ...state,
        nodes: state.nodes.map(n => n.id === action.payload.id ? { ...n, status: action.payload.status, lastModified: now } : n),
        metadata: { ...state.metadata, lastModified: now }
      };

    case 'TOGGLE_COLLAPSE':
      return {
        ...state,
        nodes: state.nodes.map(n => n.id === action.payload ? { ...n, collapsed: !n.collapsed } : n)
      };

    case 'INSERT_NODE': {
      const { targetId, position } = action.payload;
      let idx = state.nodes.findIndex(n => n.id === targetId);
      
      if (targetId === 'ROOT_PLACEHOLDER') idx = -1;
      
      const referenceNode = idx >= 0 ? state.nodes[idx] : null;
      
      let insertIdx = idx;
      let newDepth = 0;

      if (referenceNode) {
          newDepth = referenceNode.depth;

          if (position === 'before') {
              insertIdx = idx;
          } else {
              insertIdx = idx + 1;
              while (insertIdx < state.nodes.length && state.nodes[insertIdx].depth > referenceNode.depth) {
                  insertIdx++;
              }
          }
      } else {
          insertIdx = state.nodes.length;
          newDepth = 0;
      }
      
      if (insertIdx < 0) insertIdx = 0;
      if (insertIdx > state.nodes.length) insertIdx = state.nodes.length;

      const useTaskPlanDefaults = isTaskPlanProject(state.currentProjectPath);
      const defaultTitle = useTaskPlanDefaults ? `任务名 [${getTodayDateString()}]` : '';
      const newNode: LogNode = {
        id: generateId(),
        text: defaultTitle,
        desc: '',
        status: 'waiting',
        depth: newDepth,
        collapsed: false,
        order: referenceNode ? referenceNode.order : 0,
        lastModified: now
      };
      
      const newNodes = [...state.nodes];
      newNodes.splice(insertIdx, 0, newNode);
      const newNodeContent = useTaskPlanDefaults
        ? buildNodeContent(defaultTitle)
        : state.ui.useNodeTemplate
          ? `${EMPTY_NODE_CONTENT}${NEW_NODE_BODY_TEMPLATE}\n`
          : EMPTY_NODE_CONTENT;
      
      return {
        ...state,
        nodes: newNodes,
        contentMap: {
          ...state.contentMap,
          [newNode.id]: newNodeContent
        },
        activeNodeId: newNode.id,
        metadata: { ...state.metadata, lastModified: now }
      };
    }

    case 'DELETE_NODE': {
      const { id, includeDescendants } = action.payload;
      const idx = state.nodes.findIndex(n => n.id === id);
      if (idx === -1) return state;
      const targetNode = state.nodes[idx];
      
      let childEndIdx = idx + 1;
      while (childEndIdx < state.nodes.length && state.nodes[childEndIdx].depth > targetNode.depth) {
        childEndIdx++;
      }
      
      const deletedIds = includeDescendants
        ? state.nodes.slice(idx, childEndIdx).map(n => n.id)
        : [id];
      
      const processedNodes = [...state.nodes];
      if (!includeDescendants) {
        for (let i = idx + 1; i < childEndIdx; i++) {
          processedNodes[i] = { ...processedNodes[i], depth: Math.max(0, processedNodes[i].depth - 1) };
        }
      }
      
      processedNodes.splice(idx, includeDescendants ? childEndIdx - idx : 1);
      
      let newActiveId = state.activeNodeId;
      if (deletedIds.includes(state.activeNodeId || '')) {
        newActiveId = processedNodes[Math.max(0, idx - 1)]?.id || (processedNodes.length > 0 ? processedNodes[0].id : null);
      }

      let newFocusedNodeId = state.focusedNodeId;
      if (state.focusedNodeId && deletedIds.includes(state.focusedNodeId)) {
        newFocusedNodeId = null;
      }

      const newContentMap = { ...state.contentMap };
      deletedIds.forEach((deletedId) => {
        delete newContentMap[deletedId];
      });

      return {
        ...state,
        nodes: processedNodes,
        contentMap: newContentMap,
        nodeClipboard: null,
        activeNodeId: newActiveId,
        focusedNodeId: newFocusedNodeId,
        metadata: { ...state.metadata, lastModified: now }
      };
    }

    case 'INDENT_NODE': {
      const idx = state.nodes.findIndex(n => n.id === action.payload);
      if (idx <= 0) return state; 
      
      const current = state.nodes[idx];
      const prev = state.nodes[idx - 1];
      
      if (current.depth < prev.depth + 1) {
        const newNodes = [...state.nodes];
        newNodes[idx] = { ...current, depth: current.depth + 1, lastModified: now };
        return { ...state, nodes: newNodes, metadata: { ...state.metadata, lastModified: now } };
      }
      return state;
    }

    case 'INDENT_SUBTREE': {
      const idx = state.nodes.findIndex(n => n.id === action.payload);
      if (idx <= 0) return state;

      const current = state.nodes[idx];
      const prev = state.nodes[idx - 1];
      if (current.depth >= prev.depth + 1) return state;

      const newNodes = [...state.nodes];
      let end = idx + 1;
      while (end < newNodes.length && newNodes[end].depth > current.depth) {
        end++;
      }

      for (let i = idx; i < end; i++) {
        newNodes[i] = { ...newNodes[i], depth: newNodes[i].depth + 1, lastModified: now };
      }

      return { ...state, nodes: newNodes, metadata: { ...state.metadata, lastModified: now } };
    }

    case 'OUTDENT_NODE': {
      const idx = state.nodes.findIndex(n => n.id === action.payload);
      if (idx === -1) return state;
      
      const current = state.nodes[idx];
      if (current.depth > 0) {
        const newNodes = [...state.nodes];
        newNodes[idx] = { ...current, depth: current.depth - 1, lastModified: now };
        
        for (let i = idx + 1; i < newNodes.length; i++) {
          if (newNodes[i].depth <= current.depth) break; 
          newNodes[i] = { ...newNodes[i], depth: newNodes[i].depth - 1 };
        }
        
        return { ...state, nodes: newNodes, metadata: { ...state.metadata, lastModified: now } };
      }
      return state;
    }

    case 'MOVE_NODE': {
        const { sourceId, targetId, position } = action.payload;
        if (sourceId === targetId) return state;

        const allNodes = [...state.nodes];
        const srcIndex = allNodes.findIndex(n => n.id === sourceId);
        if (srcIndex === -1) return state;

        const srcNode = allNodes[srcIndex];
        let srcEndIndex = srcIndex + 1;
        while (srcEndIndex < allNodes.length && allNodes[srcEndIndex].depth > srcNode.depth) {
            srcEndIndex++;
        }
        
        const tgtIndexRaw = allNodes.findIndex(n => n.id === targetId);
        if (tgtIndexRaw >= srcIndex && tgtIndexRaw < srcEndIndex) return state;

        const sourceBlock = allNodes.splice(srcIndex, srcEndIndex - srcIndex);

        let tgtIndex = allNodes.findIndex(n => n.id === targetId);
        if (tgtIndex === -1) return state; 

        const targetNode = allNodes[tgtIndex];
        
        let insertIndex = tgtIndex;
        
        if (position === 'bottom') {
            let nextSiblingIndex = tgtIndex + 1;
            while (nextSiblingIndex < allNodes.length && allNodes[nextSiblingIndex].depth > targetNode.depth) {
                nextSiblingIndex++;
            }
            insertIndex = nextSiblingIndex;
        } 

        const depthDelta = targetNode.depth - srcNode.depth;
        const updatedSourceBlock = sourceBlock.map(node => ({
            ...node,
            depth: Math.max(0, node.depth + depthDelta),
            lastModified: now
        }));

        allNodes.splice(insertIndex, 0, ...updatedSourceBlock);

        return {
            ...state,
            nodes: allNodes,
            metadata: { ...state.metadata, lastModified: now }
        };
    }

    case 'EXTRACT_PROJECT': {
        const targetId = action.payload;
        const nodes = state.nodes;
        const targetIndex = nodes.findIndex(n => n.id === targetId);
        
        if (targetIndex === -1) return state;
        
        const targetNode = nodes[targetIndex];
        
        // 1. Collect descendants (Children become new roots)
        const newNodes: LogNode[] = [];
        const depthOffset = targetNode.depth + 1;

        for (let i = targetIndex + 1; i < nodes.length; i++) {
            if (nodes[i].depth > targetNode.depth) {
                newNodes.push({
                    ...nodes[i],
                    depth: nodes[i].depth - depthOffset,
                    lastModified: now
                });
            } else {
                break;
            }
        }
        
        // 2. Prepare Content Map
        const newContentMap: ContentMap = {
            // Promote target node content to Global Root
            root: state.contentMap[targetId] || '' 
        };

        // 3. Handle Empty Project Case (Target had no children)
        if (newNodes.length === 0) {
             const newRootId = generateId();
             newNodes.push({ 
                 id: newRootId, 
                 text: '', 
                 desc: '', 
                 status: 'waiting', 
                 depth: 0, 
                 collapsed: false, 
                 order: 0, 
                 lastModified: now 
             });
             newContentMap[newRootId] = '# \n\n';
        } else {
             // Migrate content for preserved nodes
             newNodes.forEach(node => {
                if (state.contentMap[node.id]) {
                    newContentMap[node.id] = state.contentMap[node.id];
                }
            });
        }
        
        return {
            ...state,
            projectName: targetNode.text || DEFAULT_PROJECT_NAME,
            nodes: newNodes,
            contentMap: newContentMap,
            currentProjectPath: null,
            nodeClipboard: null,
            activeNodeId: newNodes[0].id,
            focusedNodeId: null, // Exit focus mode
            versions: [],
            metadata: {
                ...state.metadata,
                createdAt: now,
                lastModified: now,
                lastExported: undefined // Reset export status
            }
        };
    }

    case 'IMPORT_DATA': {
      const data = action.payload.data;
      const importActiveNodeId = resolveActiveNodeId(data.nodes, data.activeNodeId);
      const importFocusedNodeId = resolveFocusedNodeId(data.nodes, data.focusedNodeId);
      return {
        ...state,
        projectName: data.projectName || DEFAULT_PROJECT_NAME,
        nodes: data.nodes,
        contentMap: data.contentMap,
        currentProjectPath: action.payload.projectPath ?? data.currentProjectPath ?? null,
        nodeClipboard: null,
        layoutMode: data.layoutMode || 'horizontal',
        metadata: {
            ...data.metadata,
            lastExported: now
        },
        activeNodeId: importActiveNodeId,
        focusedNodeId: importFocusedNodeId,
        versions: [],
        ui: { 
            ...state.ui, 
            viewMode: data.ui?.viewMode || ((data.ui as any)?.sidebarVisible === false ? 'editor' : 'split'),
            showOutlineDetails: data.ui?.showOutlineDetails ?? true,
            theme: data.ui?.theme || 'light',
            backgroundPreset: state.ui.backgroundPreset,
            showNodeLastModified: state.ui.showNodeLastModified,
            outlineMode: data.ui?.outlineMode || 'tree',
            hideOnHold: data.ui?.hideOnHold ?? false,
            showFocusedRoot: data.ui?.showFocusedRoot ?? false,
            useNodeTemplate: data.ui?.useNodeTemplate ?? true,
            autoBackupOnSaveVersion: data.ui?.autoBackupOnSaveVersion ?? false
        }
      };
    }

    case 'RESET_PROJECT':
        return createEmptyState(state.ui.isMobile);

    case 'SET_MOBILE':
      return { ...state, ui: { ...state.ui, isMobile: action.payload } };

    case 'TOGGLE_STATS':
      return { ...state, ui: { ...state.ui, showStats: action.payload } };

    case 'TOGGLE_VERSIONS':
      return { ...state, ui: { ...state.ui, showVersions: action.payload } };

    case 'SET_VIEW_MODE':
      return { 
          ...state, 
          ui: { 
              ...state.ui, 
              viewMode: action.payload 
          } 
      };

    case 'TOGGLE_OUTLINE_DETAILS':
        return {
            ...state,
            ui: {
                ...state.ui,
                showOutlineDetails: action.payload !== undefined ? action.payload : !state.ui.showOutlineDetails
            }
        };

    case 'TOGGLE_THEME':
        return {
            ...state,
            ui: { ...state.ui, theme: state.ui.theme === 'light' ? 'dark' : 'light' }
        };

    case 'SET_BACKGROUND_PRESET':
        return {
            ...state,
            ui: { ...state.ui, backgroundPreset: action.payload }
        };

    case 'TOGGLE_NODE_LAST_MODIFIED':
        return {
            ...state,
            ui: {
                ...state.ui,
                showNodeLastModified: action.payload !== undefined ? action.payload : !state.ui.showNodeLastModified
            }
        };

    case 'TOGGLE_OUTLINE_MODE':
        return {
            ...state,
            ui: { ...state.ui, outlineMode: state.ui.outlineMode === 'tree' ? 'list' : 'tree' }
        };

    case 'TOGGLE_HIDE_ON_HOLD':
        return {
            ...state,
            ui: {
                ...state.ui,
                hideOnHold: action.payload !== undefined ? action.payload : !state.ui.hideOnHold
            }
        };

    case 'TOGGLE_ROOT_FOCUS_VIEW':
        return {
            ...state,
            ui: {
                ...state.ui,
                showFocusedRoot: action.payload !== undefined ? action.payload : !state.ui.showFocusedRoot
            }
        };

    case 'TOGGLE_NODE_TEMPLATE':
        return {
            ...state,
            ui: {
                ...state.ui,
                useNodeTemplate: action.payload !== undefined ? action.payload : !state.ui.useNodeTemplate
            }
        };

    case 'TOGGLE_AUTO_BACKUP_ON_SAVE_VERSION':
        return {
            ...state,
            ui: {
                ...state.ui,
                autoBackupOnSaveVersion: action.payload !== undefined
                  ? action.payload
                  : !state.ui.autoBackupOnSaveVersion
            }
        };

    case 'UPDATE_LAST_EXPORTED':
        return {
            ...state,
            metadata: {
                ...state.metadata,
                lastExported: now
            }
        };

    case 'MARK_VERSION_BACKUP':
        return {
            ...state,
            metadata: {
                ...state.metadata,
                lastVersionBackupAt: now
            }
        };

    case 'SAVE_VERSION': {
        const entry: VersionEntry = {
            id: generateId(),
            createdAt: now,
            data: buildProjectData(state),
            activeNodeId: state.activeNodeId,
            focusedNodeId: state.focusedNodeId
        };
        const versions = [entry, ...state.versions].slice(0, MAX_VERSIONS);
        return { ...state, versions };
    }

    case 'ROLLBACK_VERSION': {
        const target = state.versions.find(v => v.id === action.payload);
        if (!target) return state;

        const data = target.data;
        return {
            ...state,
            projectName: data.projectName || DEFAULT_PROJECT_NAME,
            nodes: data.nodes,
            contentMap: { ...data.contentMap, root: data.contentMap.root || '' },
            nodeClipboard: null,
            currentProjectPath: data.currentProjectPath || state.currentProjectPath,
            layoutMode: data.layoutMode || 'horizontal',
            metadata: { ...data.metadata, lastModified: now },
            activeNodeId: target.activeNodeId || data.nodes[0]?.id || null,
            focusedNodeId: target.focusedNodeId || null,
            ui: {
                ...state.ui,
                viewMode: data.ui?.viewMode || state.ui.viewMode,
                showOutlineDetails: data.ui?.showOutlineDetails ?? state.ui.showOutlineDetails,
                theme: data.ui?.theme || state.ui.theme,
                backgroundPreset: state.ui.backgroundPreset,
                showNodeLastModified: state.ui.showNodeLastModified,
                outlineMode: data.ui?.outlineMode || state.ui.outlineMode,
                hideOnHold: data.ui?.hideOnHold ?? state.ui.hideOnHold,
                showFocusedRoot: data.ui?.showFocusedRoot ?? state.ui.showFocusedRoot,
                useNodeTemplate: data.ui?.useNodeTemplate ?? state.ui.useNodeTemplate,
                autoBackupOnSaveVersion: data.ui?.autoBackupOnSaveVersion ?? state.ui.autoBackupOnSaveVersion
            }
        };
    }

    default:
      return state;
  }
};

// --- Context ---
interface StoreContextType {
  state: State;
  dispatch: React.Dispatch<Action>;
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, null, getInitialState);

  // Persist to LocalStorage
  useEffect(() => {
    const dataToSave: ProjectData & { versions?: VersionEntry[] } = {
      projectName: state.projectName,
      nodes: state.nodes,
      contentMap: state.contentMap,
      activeNodeId: state.activeNodeId,
      metadata: state.metadata,
      layoutMode: state.layoutMode,
      versions: state.versions,
      focusedNodeId: state.focusedNodeId,
      currentProjectPath: state.currentProjectPath,
      ui: { 
        viewMode: state.ui.viewMode,
        showOutlineDetails: state.ui.showOutlineDetails,
        theme: state.ui.theme,
        backgroundPreset: state.ui.backgroundPreset,
        showNodeLastModified: state.ui.showNodeLastModified,
        outlineMode: state.ui.outlineMode,
        hideOnHold: state.ui.hideOnHold,
        showFocusedRoot: state.ui.showFocusedRoot,
        useNodeTemplate: state.ui.useNodeTemplate,
        autoBackupOnSaveVersion: state.ui.autoBackupOnSaveVersion
      } 
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
  }, [state]);

  // Handle Resize
  useEffect(() => {
    const handleResize = () => dispatch({ type: 'SET_MOBILE', payload: window.innerWidth < MOBILE_THRESHOLD });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <StoreContext.Provider value={{ state, dispatch }}>
      {children}
    </StoreContext.Provider>
  );
};

export const useStore = () => {
  const context = useContext(StoreContext);
  if (!context) throw new Error("useStore must be used within StoreProvider");
  return context;
};
