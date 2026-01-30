import React, { useState, useEffect, useRef, useId, useCallback, useMemo } from 'react';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { useStore } from '../context/Store';
import { IconEye, IconEdit, IconDownload, IconUpload } from './Icons';
import StatusMenu from './StatusMenu'; 
import { formatDate, sanitizeFilename, formatDateForFilename, saveFile } from '../utils/helpers';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';

// Define a simplified markdown grammar for Prism
const grammar = {
    'heading': { pattern: /^#{1,6}.+/m },
    'bold': { pattern: /\*\*(?:(?!\*\*).)+\*\*|__(?:(?!__).)+__/ },
    'italic': { pattern: /\*(?:(?!\*).)+\*|_(?:(?!_).)+_/ },
    'underline': { pattern: /<u>(?:(?!<\/u>).)+<\/u>/ },
    'strike': { pattern: /~~(?:(?!~~).)+~~/ },
    'link': { pattern: /\[(?:(?!\]).)+\]\((?:(?!\)).)+\)/ },
    'list': { pattern: /^[\t ]*[-*+] /m },
    'quote': { pattern: /^[\t ]*> /m },
    'code': { pattern: /(`+)(?:(?!\1).)+\1/ },
};

interface EditorProps {
  nodeId: string | null;
  isRoot?: boolean;
}

const ResearchEditor: React.FC<EditorProps> = ({ nodeId, isRoot = false }) => {
  const { state, dispatch } = useStore();
  const { contentMap, nodes, ui } = state;
  const [isPreview, setIsPreview] = useState(false);
  const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
  
  // File Input for Import
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Debounce Timer Ref
  const updateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Unique ID for textarea to allow direct DOM manipulation for Import
  const uniqueId = useId();
  const textareaId = `editor-area-${uniqueId}`;

  // Content Source
  const contentKey = isRoot ? 'root' : nodeId!;
  const rawContent = contentMap[contentKey] || '';
  const node = isRoot ? null : nodes.find(n => n.id === nodeId);

  // --- INITIAL STATE CALCULATION ---
  const [title, setTitle] = useState(() => {
    if (isRoot) return '';
    const lines = rawContent.split('\n');
    return (lines[0] || '').replace(/^#+\s*/, '');
  });

  const [desc, setDesc] = useState(() => {
    if (isRoot) return '';
    const lines = rawContent.split('\n');
    return (lines[1] || '').replace(/^>\s*/, '');
  });

  const [body, setBody] = useState(() => {
    if (isRoot) return rawContent;
    const lines = rawContent.split('\n');
    return lines.slice(2).join('\n');
  });

  // Keep refs for title/desc to avoid stale closures in debounced callbacks
  const titleRef = useRef(title);
  const descRef = useRef(desc);

  useEffect(() => { titleRef.current = title; }, [title]);
  useEffect(() => { descRef.current = desc; }, [desc]);

  // Track editing state for Title and Desc
  const [editingField, setEditingField] = useState<'title' | 'desc' | null>(null);

  // Input refs
  const titleInputRef = useRef<HTMLInputElement>(null);
  const descInputRef = useRef<HTMLInputElement>(null);

  // Focus management
  useEffect(() => {
    if (editingField === 'title' && titleInputRef.current) titleInputRef.current.focus();
    if (editingField === 'desc' && descInputRef.current) descInputRef.current.focus();
  }, [editingField]);

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
        if (updateTimeoutRef.current) {
            clearTimeout(updateTimeoutRef.current);
        }
    };
  }, []);

  // --- UPDATE HANDLERS ---
  
  const updateContent = useCallback((newTitle: string, newDesc: string, newBody: string) => {
      const formattedTitle = `# ${newTitle}`;
      const formattedDesc = newDesc ? `> ${newDesc}` : ''; 
      const newFullContent = `${formattedTitle}\n${formattedDesc}\n${newBody}`;
      
      dispatch({ type: 'UPDATE_CONTENT', payload: { id: contentKey, content: newFullContent } });

      if (!isRoot && nodeId) {
          dispatch({ 
              type: 'UPDATE_NODE_META', 
              payload: { id: nodeId, text: newTitle, desc: newDesc } 
          });
      }
  }, [contentKey, isRoot, nodeId, dispatch]);

  const handleTitleCommit = useCallback(() => {
      setEditingField(null);
      if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
      updateContent(title, desc, body);
  }, [title, desc, body, updateContent]);

  const handleDescCommit = useCallback(() => {
      setEditingField(null);
      if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
      updateContent(title, desc, body);
  }, [title, desc, body, updateContent]);

  // Debounced Body Change
  const handleBodyChange = useCallback((val: string) => {
      setBody(val);
      
      if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
      
      updateTimeoutRef.current = setTimeout(() => {
          // Use refs to ensure latest title/desc are used
          updateContent(titleRef.current, descRef.current, val);
          updateTimeoutRef.current = null;
      }, 700);
  }, [updateContent]);

  // Debounced Raw Change (for Root)
  const handleRawChange = useCallback((val: string) => {
      setBody(val);
      
      if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
      
      updateTimeoutRef.current = setTimeout(() => {
          dispatch({ type: 'UPDATE_CONTENT', payload: { id: contentKey, content: val } });
          updateTimeoutRef.current = null;
      }, 700);
  }, [contentKey, dispatch]);

  // Save immediately on blur
  const handleEditorBlur = useCallback(() => {
      if (updateTimeoutRef.current) {
          clearTimeout(updateTimeoutRef.current);
          updateTimeoutRef.current = null;
          if (isRoot) {
               dispatch({ type: 'UPDATE_CONTENT', payload: { id: contentKey, content: body } });
          } else {
               updateContent(titleRef.current, descRef.current, body);
          }
      }
  }, [isRoot, contentKey, body, updateContent, dispatch]);

  // --- NODE IMPORT / EXPORT HANDLERS ---
  
  const handleNodeExport = () => {
    if (!node) return;
    const name = node.text || 'Untitled';
    const date = new Date(node.lastModified);
    const filename = `${sanitizeFilename(name)}_${formatDateForFilename(date)}.md`;
    saveFile(rawContent, filename, 'text/markdown');
  };

  const handleNodeImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
          // Check if current node is empty
          const isNodeEmpty = !title.trim() && !body.trim();

          // 1. Handle Title (Programmatic State Update is fine for Title)
          if (isNodeEmpty) {
              const newTitle = file.name.replace(/\.[^/.]+$/, "");
              setTitle(newTitle);
              // Immediately sync meta for title, body will follow via onChange
              if (!isRoot && nodeId) {
                  dispatch({ 
                      type: 'UPDATE_NODE_META', 
                      payload: { id: nodeId, text: newTitle, desc: descRef.current } 
                  });
              }
          }

          // 2. Handle Body via execCommand to preserve Undo History
          // We bypass React state setting here and use the DOM to simulate user input.
          // This ensures the browser's undo stack captures the "Import" as an action.
          const textarea = document.getElementById(textareaId) as HTMLTextAreaElement;
          
          if (textarea) {
                textarea.focus();
                let insertText = text;

                if (isNodeEmpty) {
                    // Overwrite: Select all content first
                    textarea.setSelectionRange(0, textarea.value.length);
                } else {
                    // Append: Move to end
                    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
                    
                    // Smart newline handling
                    const currentVal = textarea.value;
                    if (currentVal && !currentVal.endsWith('\n')) {
                        insertText = '\n\n' + text;
                    } else if (currentVal && currentVal.endsWith('\n') && !currentVal.endsWith('\n\n')) {
                         insertText = '\n' + text;
                    } else {
                         insertText = text;
                    }
                }

                // Execute Insert
                // Deprecated but the only reliable way to manipulate undo stack for textareas programmatically
                const success = document.execCommand('insertText', false, insertText);
                
                if (!success) {
                    // Fallback to standard react state update if execCommand fails
                    const newBody = isNodeEmpty ? text : (body + '\n\n' + text);
                    setBody(newBody);
                    updateContent(title, desc, newBody);
                }
                // Note: If successful, execCommand triggers the standard `onChange` event of the textarea,
                // which calls `handleBodyChange`. Our debounce logic handles the Store update naturally.
          }
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset input
  };

  // --- SHORTCUTS & FORMATTING ---
  const insertFormat = useCallback((
    textarea: HTMLTextAreaElement, 
    prefix: string, 
    suffix: string, 
    placeholder: string = 'text'
  ) => {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.substring(start, end);

    let newText = '';
    
    // Check if already wrapped
    // Need to safeguard against out of bounds
    const pLen = prefix.length;
    const sLen = suffix.length;
    const before = start >= pLen ? text.substring(start - pLen, start) : '';
    const after = end + sLen <= text.length ? text.substring(end, end + sLen) : '';

    if (before === prefix && after === suffix) {
        // Unwrap
        newText = text.substring(0, start - pLen) + selected + text.substring(end + sLen);
    } else {
        // Wrap
        const contentToWrap = selected || placeholder;
        newText = text.substring(0, start) + prefix + contentToWrap + suffix + text.substring(end);
    }

    // Manual State update (Breaks native Undo for this specific action)
    if (isRoot) {
        // We cannot use handleRawChange directly here because it debounces and we need immediate update for selection restore
        setBody(newText);
        // We trigger the debounce logic manually
        if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
        updateTimeoutRef.current = setTimeout(() => {
             dispatch({ type: 'UPDATE_CONTENT', payload: { id: contentKey, content: newText } });
             updateTimeoutRef.current = null;
        }, 700);
    } else {
        setBody(newText);
        if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
        updateTimeoutRef.current = setTimeout(() => {
             updateContent(titleRef.current, descRef.current, newText);
             updateTimeoutRef.current = null;
        }, 700);
    }
    
    // Restore selection
    setTimeout(() => {
        let newStart = start;
        let newEnd = end;
        
        if (before === prefix && after === suffix) {
             newStart = start - prefix.length;
             newEnd = start - prefix.length + selected.length;
        } else {
             newStart = start + prefix.length;
             newEnd = start + prefix.length + (selected ? selected.length : placeholder.length);
        }
        
        if (textarea) {
            textarea.focus();
            textarea.selectionStart = newStart;
            textarea.selectionEnd = newEnd;
        }
    }, 0);
  }, [isRoot, contentKey, dispatch, updateContent]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Only handle if Ctrl or Meta (Cmd) is pressed
    if (!e.ctrlKey && !e.metaKey) return;

    // Use currentTarget to ensure we get the wrapper or element we attached to, 
    // but insertFormat needs the textarea. 
    // e.target is the textarea in simple-code-editor.
    const textarea = e.target as HTMLTextAreaElement;
    if (textarea.tagName !== 'TEXTAREA') return;
    
    switch(e.key.toLowerCase()) {
        case 'b':
            e.preventDefault();
            insertFormat(textarea, '**', '**', 'bold');
            break;
        case 'i':
            e.preventDefault();
            insertFormat(textarea, '*', '*', 'italic');
            break;
        case 'u':
            e.preventDefault();
            insertFormat(textarea, '<u>', '</u>', 'underline');
            break;
        case 'k':
            e.preventDefault();
            // Simple link insertion
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const selected = textarea.value.substring(start, end);
            if (selected) {
                insertFormat(textarea, '[', '](url)');
            } else {
                insertFormat(textarea, '[', '](url)', 'text');
            }
            break;
    }
  }, [insertFormat]);

  // Memoized highlight function to prevent cursor jumping on re-render/undo
  const highlightWithPrism = useCallback((code: string) => Prism.highlight(code, grammar, 'markdown'), []);

  // Stable Style Object
  const editorStyle = useMemo(() => ({ 
        fontFamily: '"Menlo", "Monaco", "Courier New", monospace',
        minHeight: '100%',
        lineHeight: '1.625'
  }), []);

  // --- RENDER ---
  if (!isRoot && (!nodeId || !node)) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 dark:text-gray-600 bg-white dark:bg-zinc-950">
        <div className="text-center">
            <p className="text-lg font-medium">Select a node</p>
            <p className="text-sm mt-2">Choose an item from the outline.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-zinc-950 relative group transition-colors">
      {/* Hidden File Input for Import */}
      <input type="file" ref={fileInputRef} onChange={handleNodeImport} accept=".md,.txt" className="hidden" />

      {/* Toolbar */}
      <div className="absolute top-2 right-4 z-10 flex items-center gap-2">
          <span className="text-[10px] text-gray-300 dark:text-zinc-600 uppercase font-bold tracking-widest border border-gray-100 dark:border-zinc-800 px-2 py-1 rounded select-none">
              {isRoot ? 'GLOBAL CONTEXT' : 'DETAIL EDITOR'}
          </span>
          <button
            onClick={() => setIsPreview(!isPreview)}
            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 dark:hover:text-blue-400 rounded-md transition-colors bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm border border-gray-100 dark:border-zinc-800 shadow-sm"
            title={isPreview ? "Switch to Edit Mode" : "Switch to Preview Mode"}
          >
            {isPreview ? <IconEdit className="w-4 h-4" /> : <IconEye className="w-4 h-4" />}
          </button>
      </div>

      <div className="flex-1 overflow-y-auto relative flex flex-col">
        {isRoot ? (
            // --- ROOT MODE ---
            isPreview ? (
                <div className="w-full h-full p-8 overflow-y-auto">
                    <article className="prose prose-sm sm:prose lg:prose-lg xl:prose-xl max-w-none dark:prose-invert">
                        <Markdown rehypePlugins={[rehypeRaw]}>{rawContent || '*No content*'}</Markdown>
                    </article>
                </div>
            ) : (
                <div className="flex-1 p-8 prism-editor-wrapper">
                    <Editor
                        value={body}
                        textareaId={textareaId}
                        onValueChange={handleRawChange}
                        onBlur={handleEditorBlur}
                        highlight={highlightWithPrism}
                        padding={0}
                        onKeyDown={handleKeyDown}
                        className="font-mono text-lg text-gray-800 dark:text-gray-200 min-h-[400px]"
                        textareaClassName="focus:outline-none"
                        style={editorStyle}
                    />
                </div>
            )
        ) : (
            // --- NODE MODE ---
            <div className="flex flex-col min-h-full p-8 max-w-4xl mx-auto w-full">
                
                {/* Header Section */}
                <div className="mb-2 flex items-end justify-between gap-4">
                    <div className="flex-1 min-w-0">
                        {editingField === 'title' ? (
                            <input
                                ref={titleInputRef}
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                onBlur={handleTitleCommit}
                                onKeyDown={(e) => e.key === 'Enter' && handleTitleCommit()}
                                placeholder="Untitled Node"
                                className="w-full text-3xl font-bold text-gray-900 dark:text-gray-100 placeholder-gray-300 dark:placeholder-zinc-600 border-none focus:ring-0 focus:outline-none bg-transparent p-0"
                            />
                        ) : (
                            <h1 
                                className={`text-3xl font-bold p-0 cursor-text select-none ${title ? 'text-gray-900 dark:text-gray-100' : 'text-gray-300 dark:text-zinc-600'}`}
                                onDoubleClick={() => setEditingField('title')}
                            >
                                {title || 'Untitled Node'}
                            </h1>
                        )}
                    </div>

                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        {node && (
                             <StatusMenu 
                                currentStatus={node.status} 
                                onChange={(s) => dispatch({ type: 'SET_STATUS', payload: { id: node.id, status: s } })}
                                isOpen={isStatusMenuOpen}
                                onToggle={() => setIsStatusMenuOpen(!isStatusMenuOpen)}
                                showLabel={true}
                              />
                        )}
                        
                        {node?.lastModified && (
                            <div className="text-xs text-gray-400 dark:text-zinc-500 font-mono select-none my-0.5" title="Last Modified">
                            {formatDate(node.lastModified)}
                            </div>
                        )}

                        <div className="flex items-center bg-gray-50 dark:bg-zinc-800 rounded-lg border border-gray-100 dark:border-zinc-700 p-0.5 opacity-60 hover:opacity-100 transition-opacity mt-1">
                            <button 
                                onClick={handleNodeExport} 
                                className="p-1 hover:bg-gray-200 dark:hover:bg-zinc-700 rounded text-gray-500 hover:text-blue-600 dark:hover:text-blue-400" 
                                title="Export Node Markdown"
                            >
                                <IconDownload className="w-4 h-4" />
                            </button>
                            <button 
                                onClick={() => fileInputRef.current?.click()} 
                                className="p-1 hover:bg-gray-200 dark:hover:bg-zinc-700 rounded text-gray-500 hover:text-blue-600 dark:hover:text-blue-400" 
                                title="Import Markdown (Append)"
                            >
                                <IconUpload className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>
                
                {/* Description */}
                {ui.showOutlineDetails && (
                    <div>
                        {editingField === 'desc' ? (
                            <input
                                ref={descInputRef}
                                type="text"
                                value={desc}
                                onChange={(e) => setDesc(e.target.value)}
                                onBlur={handleDescCommit}
                                onKeyDown={(e) => e.key === 'Enter' && handleDescCommit()}
                                placeholder="Add a brief description..."
                                className="w-full text-lg text-gray-500 dark:text-gray-400 placeholder-gray-300 dark:placeholder-zinc-600 border-none focus:ring-0 focus:outline-none bg-transparent p-0"
                            />
                        ) : (
                            <p 
                                className={`text-lg p-0 cursor-text select-none ${desc ? 'text-gray-500 dark:text-gray-400' : 'text-gray-300 dark:text-zinc-600 italic'}`}
                                onDoubleClick={() => setEditingField('desc')}
                            >
                                {desc || 'Double-click to add description...'}
                            </p>
                        )}
                    </div>
                )}

                <div className="w-full h-px bg-gray-100 dark:bg-zinc-800 my-6" />

                {/* Body / Editor */}
                {isPreview ? (
                    <article className="prose prose-sm sm:prose lg:prose-lg xl:prose-xl max-w-none flex-1 dark:prose-invert">
                        <Markdown rehypePlugins={[rehypeRaw]}>{body || '*No content*'}</Markdown>
                    </article>
                ) : (
                    <div className="flex-1 prism-editor-wrapper">
                         <Editor
                            value={body}
                            textareaId={textareaId}
                            onValueChange={handleBodyChange}
                            onBlur={handleEditorBlur}
                            highlight={highlightWithPrism}
                            padding={0}
                            onKeyDown={handleKeyDown}
                            className="font-mono text-lg text-gray-800 dark:text-gray-200 min-h-[400px]"
                            textareaClassName="focus:outline-none"
                            style={editorStyle}
                        />
                    </div>
                )}
            </div>
        )}
      </div>
    </div>
  );
};

export default ResearchEditor;