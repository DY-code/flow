import React, { useRef, useEffect, useState } from 'react';
import { useStore } from '../context/Store';
import StatusMenu from './StatusMenu';
import { LogNode } from '../types';
import { IconTarget } from './Icons';

const INDENT_SIZE = 24; // Width of each indentation level in pixels

const OutlineTree: React.FC = () => {
  const { state, dispatch } = useStore();
  const { nodes, activeNodeId, focusedNodeId, ui } = state;
  const listRef = useRef<HTMLDivElement>(null);
  
  // Track which menu is open to manage z-index stacking
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  
  // Track which node is currently in "Edit Mode"
  const [editingId, setEditingId] = useState<string | null>(null);

  // Drag and Drop State
  const [draggableId, setDraggableId] = useState<string | null>(null); // Which node allows dragging (hovered on handle)
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null); // Which node is being dragged
  const [dragOverInfo, setDragOverInfo] = useState<{ id: string, position: 'top' | 'bottom' } | null>(null);

  // Ref to store input elements for focus management
  const inputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});
  
  // Refs for tracking previous state to detect new nodes
  const prevNodesRef = useRef(nodes);

  // Focus the active node's input ONLY when entering edit mode
  useEffect(() => {
    if (editingId && inputRefs.current[editingId]) {
      inputRefs.current[editingId]?.focus();
    }
  }, [editingId]);

  // Auto-edit new nodes: Check if activeNodeId is new compared to previous render
  useEffect(() => {
    // If active node exists and was NOT in the previous node list, it's a new node. Enter edit mode.
    if (activeNodeId && !prevNodesRef.current.find(n => n.id === activeNodeId)) {
        setEditingId(activeNodeId);
    }
    prevNodesRef.current = nodes;
  }, [nodes, activeNodeId]);

  // --- FILTERING & VISUALIZATION LOGIC FOR FOCUS MODE ---
  
  // Helper to get visible nodes (calculated for navigation logic + rendering)
  // Also applies Focus Mode filtering
  const getVisibleNodes = () => {
    let filteredNodes: LogNode[] = nodes;
    
    // 1. Focus Mode Filter
    if (focusedNodeId) {
        const focusedIndex = nodes.findIndex(n => n.id === focusedNodeId);
        if (focusedIndex !== -1) {
            const focusedNode = nodes[focusedIndex];
            const focusedNodes = [focusedNode];
            
            // Collect descendants
            for (let i = focusedIndex + 1; i < nodes.length; i++) {
                if (nodes[i].depth > focusedNode.depth) {
                    focusedNodes.push(nodes[i]);
                } else {
                    break;
                }
            }
            filteredNodes = focusedNodes;
        }
    }

    // 2. Collapse Filter
    const visible: LogNode[] = [];
    let skipUntilDepth: number | null = null;
    
    filteredNodes.forEach(node => {
      // If we are skipping due to parent collapse (and this node is deeper than parent)
      if (skipUntilDepth !== null && node.depth > skipUntilDepth) return;
      
      visible.push(node);
      
      if (node.collapsed) skipUntilDepth = node.depth;
      else skipUntilDepth = null;
    });
    
    return visible;
  };

  const visibleNodes = getVisibleNodes();

  // Determine Visual Depth Offset based on Focus
  const focusedNode = focusedNodeId ? nodes.find(n => n.id === focusedNodeId) : null;
  const baseDepth = focusedNode ? focusedNode.depth : 0;

  // Helper: Check if a vertical line is needed at a specific depth for a specific node index.
  const shouldDrawVerticalLine = (currentIndex: number, relativeDepthToCheck: number) => {
      // relativeDepthToCheck is 1-based index (e.g. 1st line, 2nd line) relative to visual root
      // Actual depth to check against needs to consider baseDepth
      const absoluteDepthToCheck = baseDepth + relativeDepthToCheck;

      for (let i = currentIndex + 1; i < visibleNodes.length; i++) {
          const node = visibleNodes[i];
          if (node.depth < absoluteDepthToCheck) return false; // Scope closed
          if (node.depth === absoluteDepthToCheck) return true; // Found continuation
      }
      return false;
  };

  // --- Keyboard Logic (Container Level) ---
  const handleContainerKeyDown = (e: React.KeyboardEvent) => {
    if (editingId) return; // Ignore tree nav if typing in an input

    const activeIndex = visibleNodes.findIndex(n => n.id === activeNodeId);
    
    // If we can't find the active node in visible list, we can't navigate relative to it
    if (activeIndex === -1 && visibleNodes.length > 0 && ['ArrowUp', 'ArrowDown'].includes(e.key)) {
        return;
    }
    
    const node = visibleNodes[activeIndex];

    // Prevent default scrolling/tabbing for custom nav keys
    // Allow Ctrl+Enter to pass through if we don't handle it here (though we do handle it)
    if (['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'F2', 'Backspace', 'Delete'].includes(e.key) || (e.key === 'Enter' && e.ctrlKey)) {
        if(e.key !== 'Tab') e.preventDefault();
    }
    
    e.stopPropagation();

    switch (e.key) {
      case 'Enter': {
        if (e.ctrlKey) {
            // Ctrl+Enter: Edit Mode
            setEditingId(node.id);
        } else if (e.shiftKey) {
            // Shift+Enter: Insert Before
            dispatch({ type: 'INSERT_NODE', payload: { targetId: node.id, position: 'before' } });
        } else {
            // Enter: Insert After (Standard)
            dispatch({ type: 'INSERT_NODE', payload: { targetId: node.id, position: 'after' } });
        }
        break;
      }
      case 'F2': {
        setEditingId(node.id);
        break;
      }
      case 'Tab': {
        e.preventDefault();
        if (e.shiftKey) {
          dispatch({ type: 'OUTDENT_NODE', payload: node.id });
        } else {
          dispatch({ type: 'INDENT_NODE', payload: node.id });
        }
        break;
      }
      case 'Delete':
      case 'Backspace': {
        if (nodes.length > 1) {
            if (window.confirm('Delete this node?')) {
                dispatch({ type: 'DELETE_NODE', payload: node.id });
                // Focus remains on listRef because it's the container
            }
        }
        break;
      }
      case 'ArrowUp': {
        if (activeIndex > 0) {
          dispatch({ type: 'SET_ACTIVE_NODE', payload: visibleNodes[activeIndex - 1].id });
        }
        break;
      }
      case 'ArrowDown': {
        if (activeIndex < visibleNodes.length - 1) {
          dispatch({ type: 'SET_ACTIVE_NODE', payload: visibleNodes[activeIndex + 1].id });
        }
        break;
      }
    }
  };

  // 2. Input Edit Logic (When typing inside the input)
  const handleInputKeyDown = (e: React.KeyboardEvent) => {
      e.stopPropagation(); // Prevent container from catching Delete/Enter/Arrows
      if (e.key === 'Enter') {
          e.preventDefault();
          setEditingId(null); // Commit change
          listRef.current?.focus(); // Return focus to tree
      }
  };

  const handleTextChange = (id: string, newText: string) => {
      dispatch({ type: 'UPDATE_NODE_META', payload: { id, text: newText } });
      
      const oldContent = state.contentMap[id] || '';
      const lines = oldContent.split('\n');
      if (lines.length === 0) lines.push('');
      
      const match = lines[0].match(/^#+\s/);
      const prefix = match ? match[0] : '# ';
      lines[0] = prefix + newText;
      
      dispatch({ type: 'UPDATE_CONTENT', payload: { id, content: lines.join('\n') } });
  };

  // --- Drag & Drop Handlers ---
  
  const handleDragStart = (e: React.DragEvent, id: string) => {
      if (!draggableId || draggableId !== id) {
          e.preventDefault();
          return;
      }
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      setDraggingNodeId(id);
      
      // Create ghost image (optional, default usually works)
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
      e.preventDefault(); // Necessary to allow dropping
      e.stopPropagation();
      
      if (!draggingNodeId || draggingNodeId === targetId) return;
      
      // Calculate split (Top 50% vs Bottom 50%)
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const offset = e.clientY - rect.top;
      const position = offset < rect.height / 2 ? 'top' : 'bottom';
      
      setDragOverInfo({ id: targetId, position });
  };

  const handleDragLeave = () => {
      // We don't clear immediately to avoid flickering, 
      // but if we leave the container or node we might. 
      // For now, simpler to just let dragOver overwrite it.
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (draggingNodeId && dragOverInfo) {
          dispatch({ 
              type: 'MOVE_NODE', 
              payload: { 
                  sourceId: draggingNodeId, 
                  targetId: dragOverInfo.id, 
                  position: dragOverInfo.position 
              } 
          });
      }
      
      setDraggingNodeId(null);
      setDragOverInfo(null);
  };

  const handleDragEnd = () => {
      setDraggingNodeId(null);
      setDragOverInfo(null);
  };

  return (
    <div 
        className="flex-1 overflow-y-auto pb-20 bg-white dark:bg-zinc-900 outline-none transition-colors" 
        ref={listRef} 
        tabIndex={0} // Make container focusable
        onKeyDown={handleContainerKeyDown}
        onClick={(e) => {
            // Ensure clicking empty space focuses the list so keyboard works immediately
            if (e.target === listRef.current) {
                listRef.current.focus();
            }
        }}
    >
      {visibleNodes.map((node, index) => {
        // VISUAL DEPTH CALCULATION
        const visualDepth = node.depth - baseDepth;

        // Calculate hasChildren based on the GLOBAL nodes list (or visible, logic remains same mostly)
        const nextNodeIndex = nodes.findIndex(n => n.id === node.id) + 1;
        const nextNode = nodes[nextNodeIndex];
        const hasChildren = nextNode && nextNode.depth > node.depth;
        
        const isActive = activeNodeId === node.id;
        const isMenuOpen = openMenuId === node.id;
        const isEditing = editingId === node.id;
        
        // Drag Visuals
        const isDragTarget = dragOverInfo?.id === node.id;
        const dragPosition = isDragTarget ? dragOverInfo?.position : null;
        
        // Styles for drop indicators
        const borderTopClass = (isDragTarget && dragPosition === 'top') ? 'border-t-2 border-t-blue-500' : 'border-t border-t-transparent';
        const borderBottomClass = (isDragTarget && dragPosition === 'bottom') ? 'border-b-2 border-b-blue-500' : 'border-b border-b-transparent';
        
        return (
          <div
            key={node.id}
            draggable={draggableId === node.id}
            onDragStart={(e) => handleDragStart(e, node.id)}
            onDragOver={(e) => handleDragOver(e, node.id)}
            onDrop={(e) => handleDrop(e, node.id)}
            onDragEnd={handleDragEnd}
            className={`
              group flex items-center relative min-w-0 transition-colors
              hover:bg-gray-50 dark:hover:bg-zinc-800
              ${borderTopClass} ${borderBottomClass}
            `}
            style={{ height: '36px', zIndex: isMenuOpen ? 50 : 'auto' }}
            onClick={() => {
                dispatch({ type: 'SET_ACTIVE_NODE', payload: node.id });
                listRef.current?.focus();
            }}
          >
                {/* Indentation Layer & Connection Lines */}
                <div 
                    className="absolute left-0 top-0 bottom-0 pointer-events-none select-none overflow-visible" 
                    style={{ width: `${(visualDepth + 1) * INDENT_SIZE}px`, paddingLeft: '4px' }}
                >
                    {/* 1. Parent Descender */}
                    {hasChildren && !node.collapsed && (
                        <div 
                            className="absolute top-0 bottom-0"
                            style={{ left: `${4 + visualDepth * INDENT_SIZE}px`, width: `${INDENT_SIZE}px` }}
                        >
                            <div className="absolute left-1/2 top-1/2 bottom-0 w-px bg-gray-300 dark:bg-zinc-600 transform -translate-x-1/2" />
                        </div>
                    )}

                    {/* 2. Connectors */}
                    {Array.from({ length: visualDepth }).map((_, i) => {
                        const isParentLevel = i === visualDepth - 1;
                        const hasLine = shouldDrawVerticalLine(index, i + 1);
                        
                        return (
                            <div 
                                key={i} 
                                className="absolute top-0 bottom-0"
                                style={{ left: `${4 + i * INDENT_SIZE}px`, width: `${INDENT_SIZE}px` }}
                            >
                                {isParentLevel ? (
                                    <>
                                        <div className={`absolute left-1/2 w-px bg-gray-300 dark:bg-zinc-600 transform -translate-x-1/2 ${hasLine ? 'top-0 bottom-0' : 'top-0 h-1/2'}`} />
                                        <div className="absolute top-1/2 left-1/2 h-px bg-gray-300 dark:bg-zinc-600 w-6" /> 
                                    </>
                                ) : (
                                    hasLine && <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-300 dark:bg-zinc-600 transform -translate-x-1/2" />
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Row Content */}
                <div 
                    className="flex-1 flex items-center pr-2 z-0 min-w-0"
                    style={{ paddingLeft: `${4 + visualDepth * INDENT_SIZE}px` }}
                >
                    {/* Drag Handle / Expander / Bullet */}
                    <div 
                        className="w-6 h-6 flex-shrink-0 flex items-center justify-center cursor-grab active:cursor-grabbing relative"
                        onMouseEnter={() => setDraggableId(node.id)}
                        onMouseLeave={() => setDraggableId(null)}
                        onClick={(e) => {
                            if (hasChildren) {
                                e.stopPropagation();
                                dispatch({ type: 'TOGGLE_COLLAPSE', payload: node.id });
                            }
                        }}
                    >
                        <div className={`
                            w-2 h-2 rounded-full transition-all duration-200 z-10 box-border
                            ${(hasChildren && node.collapsed)
                                ? (isActive ? 'bg-blue-600 dark:bg-blue-500 border border-transparent' : 'bg-gray-500 dark:bg-zinc-400 border border-transparent')
                                : (isActive ? 'bg-white dark:bg-zinc-900 border-2 border-blue-600 dark:border-blue-500' : 'bg-white dark:bg-zinc-900 border border-gray-400 dark:border-zinc-500')
                            }
                            ${isActive ? 'scale-110' : ''}
                        `} />
                    </div>

                    {/* Status Icon (Moved to Left, Always Visible) */}
                    <div className="mx-0.5 flex-shrink-0 relative z-20">
                      <StatusMenu 
                        currentStatus={node.status} 
                        onChange={(s) => dispatch({ type: 'SET_STATUS', payload: { id: node.id, status: s } })}
                        isOpen={isMenuOpen}
                        onToggle={() => setOpenMenuId(isMenuOpen ? null : node.id)}
                        showLabel={false} // Only icon in tree
                      />
                    </div>

                    {/* Text Content */}
                    <div className="flex-1 flex items-center min-w-0 h-full ml-1">
                        {isEditing ? (
                            <input
                                ref={(el) => {
                                    if (el) inputRefs.current[node.id] = el;
                                    else delete inputRefs.current[node.id];
                                }}
                                type="text"
                                value={node.text}
                                onChange={(e) => handleTextChange(node.id, e.target.value)}
                                onKeyDown={handleInputKeyDown}
                                onBlur={() => setEditingId(null)}
                                className="bg-white dark:bg-zinc-800 border border-blue-400 rounded-sm flex-1 focus:outline-none text-sm font-medium text-gray-900 dark:text-gray-100 px-1 py-0.5 min-w-[50px]"
                                placeholder="Untitled"
                            />
                        ) : (
                            <div 
                                className="flex-1 flex items-center min-w-0 h-full cursor-text"
                                onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    setEditingId(node.id);
                                }}
                            >
                                <span className={`
                                    text-sm truncate 
                                    ${isActive ? 'font-bold text-gray-900 dark:text-white' : 'font-medium'}
                                    ${!node.text && !isActive ? 'text-gray-400 dark:text-gray-500 italic' : ''}
                                    ${node.text && !isActive ? 'text-gray-700 dark:text-gray-200' : ''}
                                `}>
                                    {node.text || 'Untitled'}
                                </span>
                                
                                {ui.showOutlineDetails && node.desc && (
                                    <span 
                                        className="text-xs text-gray-400 dark:text-gray-500 font-normal ml-3 truncate flex-shrink-0 max-w-[40%] select-none hover:text-gray-600 dark:hover:text-gray-400"
                                        onDoubleClick={(e) => {
                                            e.stopPropagation();
                                            setEditingId(node.id); 
                                        }}
                                    >
                                        {node.desc}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                    
                    {/* Focus Button - Only visible on hover, if not already focused on this node */}
                    <div className={`opacity-0 group-hover:opacity-100 transition-opacity ml-2 ${focusedNodeId === node.id ? 'opacity-50' : ''}`}>
                         <button
                            onClick={(e) => {
                                e.stopPropagation();
                                dispatch({ type: 'SET_FOCUSED_NODE', payload: node.id === focusedNodeId ? null : node.id });
                            }}
                            className="p-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 rounded"
                            title={node.id === focusedNodeId ? "Exit Focus" : "Focus on this node"}
                         >
                            <IconTarget className="w-3.5 h-3.5" />
                         </button>
                    </div>
                </div>
          </div>
        );
      })}
      
      {/* Empty Area Click */}
      <div 
        className="h-full min-h-[100px] cursor-default" 
        onClick={() => {
            listRef.current?.focus();
            if(nodes.length === 0) dispatch({ type: 'INSERT_NODE', payload: { targetId: 'ROOT_PLACEHOLDER', position: 'after' } });
        }}
      />
    </div>
  );
};

export default OutlineTree;