import React, { createContext, useContext, useReducer, useEffect } from 'react';
import { LogNode, ContentMap, ProjectData, NodeStatus, LayoutMode, OutlineMode, ViewMode } from '../types';
import { generateId } from '../utils/helpers';

// --- State Definition ---
interface State {
  projectName: string; 
  nodes: LogNode[];
  contentMap: ContentMap;
  activeNodeId: string | null;
  focusedNodeId: string | null; // New: For Focus Mode
  layoutMode: LayoutMode;
  metadata: {
    version: string;
    createdAt: string;
    lastModified: string;
    lastExported?: string;
  };
  ui: {
    isMobile: boolean;
    showStats: boolean;
    viewMode: ViewMode;
    showOutlineDetails: boolean;
    theme: 'light' | 'dark';
    outlineMode: OutlineMode;
  };
}

const STORAGE_KEY = 'flow-data';
const MOBILE_THRESHOLD = 768; 
const DEFAULT_PROJECT_NAME = 'Untitled Project';

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
      [rootId]: '# \n\n' 
    },
    activeNodeId: rootId,
    focusedNodeId: null,
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
      viewMode: 'split',
      showOutlineDetails: true,
      theme: 'light',
      outlineMode: 'tree'
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

      return {
        ...parsed,
        projectName: parsed.projectName || DEFAULT_PROJECT_NAME,
        nodes: parsed.nodes.map((n: any) => ({ 
            ...n, 
            desc: n.desc || '',
            lastModified: n.lastModified || parsed.metadata?.lastModified || now
        })),
        activeNodeId: parsed.nodes.length > 0 ? (parsed.activeNodeId || parsed.nodes[0].id) : null,
        focusedNodeId: parsed.focusedNodeId || null, // Load or null
        layoutMode: parsed.layoutMode || 'horizontal',
        ui: { 
            isMobile: window.innerWidth < MOBILE_THRESHOLD, 
            showStats: false,
            viewMode: initialViewMode,
            showOutlineDetails: parsed.ui?.showOutlineDetails ?? true,
            theme: parsed.ui?.theme || 'light',
            outlineMode: parsed.ui?.outlineMode || 'tree'
        },
        contentMap: { ...parsed.contentMap, root: parsed.contentMap.root || '' },
        metadata: {
            ...parsed.metadata,
            lastExported: parsed.metadata?.lastExported || parsed.metadata?.createdAt || now
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
  | { type: 'UPDATE_PROJECT_NAME'; payload: string }
  | { type: 'UPDATE_NODE_META'; payload: { id: string; text?: string; desc?: string } }
  | { type: 'UPDATE_CONTENT'; payload: { id: string; content: string } }
  | { type: 'SET_STATUS'; payload: { id: string; status: NodeStatus } }
  | { type: 'TOGGLE_COLLAPSE'; payload: string }
  | { type: 'INSERT_NODE'; payload: { targetId: string; position: 'before' | 'after' } }
  | { type: 'DELETE_NODE'; payload: string }
  | { type: 'INDENT_NODE'; payload: string }
  | { type: 'OUTDENT_NODE'; payload: string }
  | { type: 'MOVE_NODE'; payload: { sourceId: string; targetId: string; position: 'top' | 'bottom' } }
  | { type: 'EXTRACT_PROJECT'; payload: string }
  | { type: 'IMPORT_DATA'; payload: ProjectData }
  | { type: 'RESET_PROJECT' }
  | { type: 'SET_MOBILE'; payload: boolean }
  | { type: 'TOGGLE_STATS'; payload: boolean }
  | { type: 'SET_VIEW_MODE'; payload: ViewMode }
  | { type: 'TOGGLE_OUTLINE_DETAILS'; payload?: boolean }
  | { type: 'TOGGLE_THEME' }
  | { type: 'TOGGLE_OUTLINE_MODE' }
  | { type: 'SET_LAYOUT_MODE'; payload: LayoutMode }
  | { type: 'UPDATE_LAST_EXPORTED' };

const reducer = (state: State, action: Action): State => {
  const now = new Date().toISOString();
  
  switch (action.type) {
    case 'SET_ACTIVE_NODE':
      return { ...state, activeNodeId: action.payload };

    case 'SET_FOCUSED_NODE':
      return { ...state, focusedNodeId: action.payload };

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

      const newNode: LogNode = {
        id: generateId(),
        text: '',
        desc: '',
        status: 'waiting',
        depth: newDepth,
        collapsed: false,
        order: referenceNode ? referenceNode.order : 0,
        lastModified: now
      };
      
      const newNodes = [...state.nodes];
      newNodes.splice(insertIdx, 0, newNode);
      
      return {
        ...state,
        nodes: newNodes,
        contentMap: { ...state.contentMap, [newNode.id]: '# \n\n' },
        activeNodeId: newNode.id,
        metadata: { ...state.metadata, lastModified: now }
      };
    }

    case 'DELETE_NODE': {
      const idx = state.nodes.findIndex(n => n.id === action.payload);
      if (idx === -1) return state;
      const targetNode = state.nodes[idx];
      
      let childEndIdx = idx + 1;
      while (childEndIdx < state.nodes.length && state.nodes[childEndIdx].depth > targetNode.depth) {
        childEndIdx++;
      }
      
      // Identify ids being deleted to check against focusedNodeId
      const deletedIds = state.nodes.slice(idx, childEndIdx).map(n => n.id);
      
      const processedNodes = [...state.nodes];
      for (let i = idx + 1; i < childEndIdx; i++) {
         processedNodes[i] = { ...processedNodes[i], depth: Math.max(0, processedNodes[i].depth - 1) };
      }
      
      processedNodes.splice(idx, 1);
      
      let newActiveId = state.activeNodeId;
      if (state.activeNodeId === action.payload) {
        newActiveId = processedNodes[Math.max(0, idx - 1)]?.id || (processedNodes.length > 0 ? processedNodes[0].id : null);
      }

      // If the focused node (or its ancestor which was the focus root) is deleted, exit focus mode
      let newFocusedNodeId = state.focusedNodeId;
      if (state.focusedNodeId && (state.focusedNodeId === action.payload || deletedIds.includes(state.focusedNodeId))) {
          newFocusedNodeId = null;
      }
      // Also check if the *current* focusedNodeId was the one being deleted.
      if (state.focusedNodeId === action.payload) {
          newFocusedNodeId = null;
      }

      const newContentMap = { ...state.contentMap };
      delete newContentMap[action.payload];

      return {
        ...state,
        nodes: processedNodes,
        contentMap: newContentMap,
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
            activeNodeId: newNodes[0].id,
            focusedNodeId: null, // Exit focus mode
            metadata: {
                ...state.metadata,
                createdAt: now,
                lastModified: now,
                lastExported: undefined // Reset export status
            }
        };
    }

    case 'IMPORT_DATA':
      return {
        ...state,
        projectName: action.payload.projectName || DEFAULT_PROJECT_NAME,
        nodes: action.payload.nodes,
        contentMap: action.payload.contentMap,
        layoutMode: action.payload.layoutMode || 'horizontal',
        metadata: action.payload.metadata,
        activeNodeId: action.payload.nodes[0]?.id || null,
        focusedNodeId: null, // Reset focus on import
        ui: { 
            ...state.ui, 
            viewMode: action.payload.ui?.viewMode || ((action.payload.ui as any)?.sidebarVisible === false ? 'editor' : 'split'),
            showOutlineDetails: action.payload.ui?.showOutlineDetails ?? true,
            theme: action.payload.ui?.theme || 'light',
            outlineMode: action.payload.ui?.outlineMode || 'tree'
        }
      };

    case 'RESET_PROJECT':
        return createEmptyState(state.ui.isMobile);

    case 'SET_MOBILE':
      return { ...state, ui: { ...state.ui, isMobile: action.payload } };

    case 'TOGGLE_STATS':
      return { ...state, ui: { ...state.ui, showStats: action.payload } };

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

    case 'TOGGLE_OUTLINE_MODE':
        return {
            ...state,
            ui: { ...state.ui, outlineMode: state.ui.outlineMode === 'tree' ? 'list' : 'tree' }
        };

    case 'SET_LAYOUT_MODE':
        return { ...state, layoutMode: action.payload };

    case 'UPDATE_LAST_EXPORTED':
        return {
            ...state,
            metadata: {
                ...state.metadata,
                lastExported: now
            }
        };

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
    const dataToSave: ProjectData & { focusedNodeId?: string | null } = {
      projectName: state.projectName,
      nodes: state.nodes,
      contentMap: state.contentMap,
      metadata: state.metadata,
      layoutMode: state.layoutMode,
      focusedNodeId: state.focusedNodeId, // Persist focus state if desired
      ui: { 
        viewMode: state.ui.viewMode,
        showOutlineDetails: state.ui.showOutlineDetails,
        theme: state.ui.theme,
        outlineMode: state.ui.outlineMode
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