import React, { useRef, useState, useEffect } from 'react';
import { StoreProvider, useStore } from './context/Store';
import OutlineTree from './components/OutlineTree';
import Editor from './components/Editor';
import StatsModal from './components/StatsModal';
import SplitPane from './components/SplitPane';
import { 
    IconDownload, IconUpload, IconChart, IconMenu, 
    IconLayoutHorizontal, IconLayoutVertical, IconListDetails, IconFilePlus,
    IconSun, IconMoon, IconViewSplit, IconViewEditor, IconViewOutline,
    IconHome, IconChevronRight, IconChevronDown
} from './components/Icons';
import { downloadJson, downloadMarkdown } from './utils/helpers';
import { ProjectData, LogNode } from './types';

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
        <div className="h-full w-full bg-gray-50 dark:bg-zinc-900 flex flex-col transition-colors">
            {/* Header for Focus Area */}
            <div className="h-8 bg-gray-100 dark:bg-zinc-800 border-b border-gray-200 dark:border-zinc-700 flex items-center px-3 justify-between flex-shrink-0 transition-colors">
                {state.focusedNodeId ? (
                    <div className="flex items-center text-xs font-medium text-gray-600 dark:text-gray-300 overflow-hidden whitespace-nowrap mask-linear-fade">
                        <button 
                            onClick={() => dispatch({ type: 'SET_FOCUSED_NODE', payload: null })}
                            className="hover:text-blue-600 dark:hover:text-blue-400 p-0.5 rounded flex items-center"
                            title="Exit Focus Mode"
                        >
                            <IconHome className="w-3.5 h-3.5" />
                        </button>
                        {breadcrumbs.map((node, i) => (
                            <React.Fragment key={node.id}>
                                <IconChevronRight className="w-3 h-3 mx-1 text-gray-400 flex-shrink-0" />
                                <button
                                    onClick={() => dispatch({ type: 'SET_FOCUSED_NODE', payload: node.id })}
                                    className={`hover:text-blue-600 dark:hover:text-blue-400 p-0.5 rounded truncate max-w-[120px] ${i === breadcrumbs.length - 1 ? 'font-bold text-gray-900 dark:text-gray-100' : ''}`}
                                    title={node.text || 'Untitled'}
                                >
                                    {node.text || 'Untitled'}
                                </button>
                            </React.Fragment>
                        ))}
                    </div>
                ) : (
                    <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">逻辑链 & 思维流</span>
                )}
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
  
  const viewMode = state.ui.viewMode;
  const isMobile = state.ui.isMobile;
  const isDark = state.ui.theme === 'dark';

  // Export Menu State
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  
  // New Project Menu State
  const [isNewProjectMenuOpen, setIsNewProjectMenuOpen] = useState(false);
  const newProjectMenuRef = useRef<HTMLDivElement>(null);

  // Unsaved Changes Logic
  const hasUnsavedChanges = (() => {
    // 1. If nodes are empty or single empty node (initial state), consider saved.
    const isInitialEmpty = state.nodes.length === 1 && !state.nodes[0].text && !state.nodes[0].desc && !state.contentMap[state.nodes[0].id].replace('# \n\n', '').trim();
    if (isInitialEmpty && !state.contentMap['root']) return false;

    // 2. Check timestamps
    const lastModified = new Date(state.metadata.lastModified).getTime();
    const lastExported = state.metadata.lastExported ? new Date(state.metadata.lastExported).getTime() : 0;
    
    // Allow a small grace period (e.g., 100ms) to avoid race conditions between render/save
    return lastModified > lastExported + 100; 
  })();

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
        if (newProjectMenuRef.current && !newProjectMenuRef.current.contains(event.target as Node)) {
            setIsNewProjectMenuOpen(false);
        }
    };
    // Only add listener if either menu is open
    if (isExportMenuOpen || isNewProjectMenuOpen) {
        document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isExportMenuOpen, isNewProjectMenuOpen]);

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string) as ProjectData;
        if (json.nodes && json.contentMap) {
            if(window.confirm('Overwrite current project?')) {
                dispatch({ type: 'IMPORT_DATA', payload: json });
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

  const handleExportJson = async () => {
    const data: ProjectData = {
        projectName: state.projectName,
        nodes: state.nodes,
        contentMap: state.contentMap,
        metadata: state.metadata,
        layoutMode: state.layoutMode,
        ui: state.ui
    };
    const saved = await downloadJson(data, `${getSafeFilename()}.json`);
    if (saved) {
        dispatch({ type: 'UPDATE_LAST_EXPORTED' });
    }
    setIsExportMenuOpen(false);
  };

  const handleExportMarkdown = async () => {
    const data: ProjectData = {
        projectName: state.projectName,
        nodes: state.nodes,
        contentMap: state.contentMap,
        metadata: state.metadata,
        layoutMode: state.layoutMode,
        ui: state.ui
    };
    const saved = await downloadMarkdown(data, `${getSafeFilename()}.md`);
    if (saved) {
        dispatch({ type: 'UPDATE_LAST_EXPORTED' });
    }
    setIsExportMenuOpen(false);
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
        className={`p-1.5 rounded-md transition-colors ${viewMode === mode ? 'bg-white shadow text-blue-600 dark:bg-zinc-700 dark:text-blue-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300'}`}
        title={title}
    >
        <Icon className="w-4 h-4" />
    </button>
  );

  return (
    // Apply .dark class to the top wrapper based on state
    <div className={`${isDark ? 'dark' : ''} h-screen flex flex-col font-sans overflow-hidden transition-colors`}>
      <div className="h-full flex flex-col bg-gray-100 dark:bg-zinc-950 text-gray-900 dark:text-gray-100">
        
        {/* Header */}
        <header className="h-14 bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-800 flex items-center justify-between px-4 shadow-sm z-30 flex-shrink-0 relative transition-colors">
            <div className="flex items-center gap-3 flex-1 min-w-0 z-10">
                {/* View Mode Switcher */}
                {isMobile ? (
                    <button 
                        onClick={() => dispatch({ type: 'SET_VIEW_MODE', payload: viewMode === 'editor' ? 'split' : 'editor' })} 
                        className={`p-2 rounded-lg transition-colors ${viewMode !== 'editor' ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-zinc-800'}`}
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
                <div className="flex flex-col justify-center min-w-0 ml-2">
                    <div className="flex items-center gap-2">
                        <div className="inline-grid items-center max-w-[400px] -ml-1.5 relative overflow-hidden rounded">
                            {/* Mirror Span for Width Calculation */}
                            <span className="col-start-1 row-start-1 font-bold text-lg tracking-tight px-1.5 py-0.5 invisible whitespace-pre border border-transparent min-w-0">
                                {state.projectName || "Untitled Project"}
                            </span>
                            
                            {/* Actual Input */}
                            <input 
                                type="text"
                                value={state.projectName}
                                onChange={(e) => dispatch({ type: 'UPDATE_PROJECT_NAME', payload: e.target.value })}
                                className="col-start-1 row-start-1 w-full h-full font-bold text-gray-800 dark:text-gray-100 tracking-tight text-lg bg-transparent border border-transparent focus:border-gray-200 dark:focus:border-zinc-700 focus:bg-gray-50 dark:focus:bg-zinc-800 hover:border-gray-100 dark:hover:border-zinc-800 rounded px-1.5 py-0.5 transition-all outline-none truncate min-w-0"
                                placeholder="Untitled Project"
                                title="Click to edit project name"
                            />
                        </div>
                        {/* Status Indicator */}
                        <div 
                            className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${hasUnsavedChanges ? 'bg-orange-500 animate-pulse' : 'bg-green-500'}`} 
                            title={hasUnsavedChanges ? "Unexported changes" : "All changes exported"}
                        />
                    </div>
                    <span className="text-[9px] text-gray-400 dark:text-gray-500 font-mono pl-0.5 hidden sm:block">V2.0 • LOCAL STORAGE</span>
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
                    {/* Theme Toggle */}
                    <button
                        onClick={() => dispatch({ type: 'TOGGLE_THEME' })}
                        className="p-1.5 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded-md"
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
                                className={`p-1.5 rounded-md ${state.layoutMode === 'horizontal' ? 'bg-white shadow text-blue-600 dark:bg-zinc-700 dark:text-blue-400' : 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'}`}
                                title="Side-by-side view"
                            >
                                <IconLayoutHorizontal className="w-4 h-4" />
                            </button>
                            <button 
                                onClick={() => dispatch({ type: 'SET_LAYOUT_MODE', payload: 'vertical' })}
                                className={`p-1.5 rounded-md ${state.layoutMode === 'vertical' ? 'bg-white shadow text-blue-600 dark:bg-zinc-700 dark:text-blue-400' : 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'}`}
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
                        className={`p-1.5 rounded-md ${state.ui.showOutlineDetails ? 'bg-white shadow text-blue-600 dark:bg-zinc-700 dark:text-blue-400' : 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'}`}
                        title={state.ui.showOutlineDetails ? "Hide node descriptions" : "Show node descriptions"}
                    >
                        <IconListDetails className="w-4 h-4" />
                    </button>
            </div>

            <button 
                    onClick={() => dispatch({ type: 'TOGGLE_STATS', payload: true })}
                    className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:text-gray-400 dark:hover:bg-zinc-800 dark:hover:text-blue-400 rounded-lg transition-colors"
                    title="Statistics"
                >
                    <IconChart className="w-5 h-5" />
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
                        className={`flex items-center gap-1 p-2 rounded-lg transition-colors ${isNewProjectMenuOpen ? 'bg-gray-100 dark:bg-zinc-800 text-blue-600 dark:text-blue-400' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-zinc-800'}`}
                        title={state.focusedNodeId ? "New Project Options" : "New Empty Project"}
                    >
                        <IconFilePlus className="w-4 h-4" />
                        {state.focusedNodeId && <IconChevronDown className="w-3 h-3" />}
                    </button>

                    {isNewProjectMenuOpen && state.focusedNodeId && (
                        <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-zinc-800 rounded-md shadow-lg py-1 border border-gray-100 dark:border-zinc-700 z-50">
                            <div className="px-4 py-2 text-xs font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider border-b border-gray-100 dark:border-zinc-700 mb-1">
                                Create New Project
                            </div>
                            <button 
                                onClick={() => handleSafeAction(performNewProject)} 
                                className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-zinc-700"
                            >
                                New Empty Project
                            </button>
                            <button 
                                onClick={() => handleSafeAction(performExtractProject)} 
                                className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-zinc-700"
                            >
                                Extract <span className="font-bold">"{getFocusedNodeText()}"</span>
                            </button>
                        </div>
                    )}
                </div>

                <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-zinc-800 rounded-lg"
                    title="Import JSON"
                >
                    <IconUpload className="w-4 h-4" />
                </button>
                <input type="file" ref={fileInputRef} onChange={handleImport} accept=".json" className="hidden" />

                {/* Export Menu */}
                <div className="relative" ref={exportMenuRef}>
                    <button 
                        onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 rounded-lg shadow-sm transition-colors"
                    >
                        <IconDownload className="w-4 h-4" />
                        <span className="hidden sm:inline">Export</span>
                    </button>
                    
                    {isExportMenuOpen && (
                        <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-zinc-800 rounded-md shadow-lg py-1 border border-gray-100 dark:border-zinc-700 z-50">
                            <button onClick={handleExportJson} className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-zinc-700">Export as JSON</button>
                            <button onClick={handleExportMarkdown} className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-zinc-700">Export as Markdown (V2.0)</button>
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
                    <div className={`fixed inset-y-0 left-0 z-40 w-3/4 bg-white dark:bg-zinc-900 shadow-2xl transform transition-transform duration-300 ${viewMode !== 'editor' ? 'translate-x-0' : '-translate-x-full'}`}>
                        <FocusArea />
                    </div>
                    {viewMode !== 'editor' && (
                        <div 
                            className="fixed inset-0 bg-black/30 z-30" 
                            onClick={() => dispatch({ type: 'SET_VIEW_MODE', payload: 'editor' })} 
                        />
                    )}
                    <div className="h-full w-full bg-white dark:bg-zinc-950">
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
                        <div className="h-full w-full bg-white dark:bg-zinc-950">
                            <FocusArea />
                        </div>
                    ) : (
                        // Editor Only: Show DetailArea full width
                        <div className="h-full w-full bg-white dark:bg-zinc-950">
                            <DetailArea />
                        </div>
                    )}
                </>
            )}
        </div>

        <StatsModal />
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