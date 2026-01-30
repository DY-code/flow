
export type NodeStatus = 'waiting' | 'inProgress' | 'completed' | 'onHold';
export type LayoutMode = 'horizontal' | 'vertical';
export type OutlineMode = 'tree' | 'list';
export type ViewMode = 'split' | 'editor' | 'outline';

export interface LogNode {
  id: string;
  text: string;
  desc: string; // Short description (synced with 2nd line of editor)
  status: NodeStatus;
  depth: number;
  collapsed: boolean;
  order: number;
  lastModified: string; // ISO Timestamp
}

export interface ContentMap {
  [key: string]: string;
}

export interface ProjectData {
  projectName?: string; // Project Name
  nodes: LogNode[];
  contentMap: ContentMap;
  layoutMode: LayoutMode;
  metadata: {
    version: string;
    createdAt: string;
    lastModified: string;
    lastExported?: string; // ISO Timestamp of last export
  };
  ui?: {
    showOutlineDetails?: boolean;
    theme?: 'light' | 'dark';
    outlineMode?: OutlineMode;
    viewMode?: ViewMode; // Replaces sidebarVisible
  };
}

export interface DragItem {
  id: string;
  index: number;
}
