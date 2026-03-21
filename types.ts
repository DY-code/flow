
export type NodeStatus = 'waiting' | 'inProgress' | 'completed' | 'onHold';
export type LayoutMode = 'horizontal' | 'vertical';
export type OutlineMode = 'tree' | 'list';
export type ViewMode = 'split' | 'editor' | 'outline';
export type BackgroundPreset = 'default' | 'warm' | 'mist' | 'sage';

export interface LogNode {
  id: string;
  text: string;
  desc: string; // Short description (synced with 2nd line of editor)
  status: NodeStatus;
  depth: number;
  collapsed: boolean;
  order: number;
  lastModified: string; // ISO Timestamp
  sourceNodeId?: string;
}

export interface ContentMap {
  [key: string]: string;
}

export interface ProjectData {
  projectName?: string; // Project Name
  nodes: LogNode[];
  contentMap: ContentMap;
  activeNodeId?: string | null;
  focusedNodeId?: string | null;
  currentProjectPath?: string | null;
  layoutMode: LayoutMode;
  metadata: {
    version: string;
    createdAt: string;
    lastModified: string;
    lastExported?: string; // ISO Timestamp of last export
    lastVersionBackupAt?: string; // ISO Timestamp of last version backup
  };
  ui?: {
    showOutlineDetails?: boolean;
    theme?: 'light' | 'dark';
    backgroundPreset?: BackgroundPreset;
    showNodeLastModified?: boolean;
    outlineMode?: OutlineMode;
    viewMode?: ViewMode; // Replaces sidebarVisible
    hideOnHold?: boolean;
    showFocusedRoot?: boolean;
    useNodeTemplate?: boolean;
    autoBackupOnSaveVersion?: boolean;
  };
}

export interface VersionEntry {
  id: string;
  createdAt: string;
  data: ProjectData;
  activeNodeId: string | null;
  focusedNodeId: string | null;
}

export interface DragItem {
  id: string;
  index: number;
}
