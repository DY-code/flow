import React, { useState, useEffect, useLayoutEffect, useRef, useId, useCallback, useMemo } from 'react';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { useStore } from '../context/Store';
import { IconEye, IconEdit, IconDownload, IconUpload } from './Icons';
import StatusMenu from './StatusMenu'; 
import { formatDate, sanitizeFilename, formatDateForFilename, saveFile, readTextFile } from '../utils/helpers';
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

interface PreviewHeadingItem {
  level: number;
  text: string;
  domIndex: number;
}

const stripMarkdownInline = (text: string): string => {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/<[^>]+>/g, '')
    .trim();
};

const parsePreviewHeadings = (markdown: string): PreviewHeadingItem[] => {
  const items: PreviewHeadingItem[] = [];
  const lines = markdown.split('\n');
  let domIndex = 0;

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const level = match[1].length;
    const text = stripMarkdownInline(match[2]);
    if (!text) {
      domIndex += 1;
      continue;
    }
    items.push({ level, text, domIndex });
    domIndex += 1;
  }

  return items;
};

interface EditorProps {
  nodeId: string | null;
  isRoot?: boolean;
  textReadOnly?: boolean;
}

const ResearchEditor: React.FC<EditorProps> = ({ nodeId, isRoot = false, textReadOnly = false }) => {
  const { state, dispatch } = useStore();
  const { contentMap, nodes, ui } = state;
  const [isPreview, setIsPreview] = useState(false);
  const [isPreviewOutlineOpen, setIsPreviewOutlineOpen] = useState(false);
  const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
  
  // File Input for Import
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Debounce Timer Refs
  const updateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null); // Full Content Save (Slow)
  const titleFastUpdateRef = useRef<ReturnType<typeof setTimeout> | null>(null); // Meta Update (Fast)
  const descFastUpdateRef = useRef<ReturnType<typeof setTimeout> | null>(null); // Meta Update (Fast)

  // Unique ID for textarea to allow direct DOM manipulation for Import
  const uniqueId = useId();
  const textareaId = `editor-area-${uniqueId}`;
  const selectionRef = useRef<{ start: number; end: number } | null>(null);
  const shouldRestoreSelectionRef = useRef(false);
  const skipSelectionCaptureRef = useRef(false);

  // Content Source
  const contentKey = isRoot ? 'root' : nodeId!;
  const rawContent = contentMap[contentKey] || '';
  const node = isRoot ? null : nodes.find(n => n.id === nodeId);
  const focusedNode = isRoot && state.focusedNodeId ? nodes.find(n => n.id === state.focusedNodeId) : null;
  const focusedNodeRaw = focusedNode ? (contentMap[focusedNode.id] || '') : '';

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
  const [focusedBody, setFocusedBody] = useState('');

  // Keep refs for title/desc/body to avoid stale closures in debounced callbacks
  const titleRef = useRef(title);
  const descRef = useRef(desc);
  const bodyRef = useRef(body);
  const focusedBodyRef = useRef(focusedBody);

  useEffect(() => { titleRef.current = title; }, [title]);
  useEffect(() => { descRef.current = desc; }, [desc]);
  useEffect(() => { bodyRef.current = body; }, [body]);
  useEffect(() => { focusedBodyRef.current = focusedBody; }, [focusedBody]);

  // Track editing state for Title and Desc
  const [editingField, setEditingField] = useState<'title' | 'desc' | null>(null);

  useEffect(() => {
    if (textReadOnly) setEditingField(null);
  }, [textReadOnly]);

  // --- SYNC LOGIC ---
  // Refs to track the LAST KNOWN external values to avoid overwriting local work with stale data
  const lastExternalTitleRef = useRef<string | null>(null);
  const lastExternalDescRef = useRef<string | null>(null);
  const lastExternalBodyRef = useRef<string | null>(null);
  const lastExternalFocusedBodyRef = useRef<string | null>(null);

  useEffect(() => {
    let incomingTitle = '';
    let incomingDesc = '';
    let incomingBody = '';

    // PARSE INCOMING PROPS
    if (isRoot) {
        // In Root mode, the Editor manages the WHOLE raw content as 'body'.
        incomingBody = rawContent;
        
        // We can still try to parse title/desc for the header state, although unused visually in Root mode editor
        const lines = rawContent.split('\n');
        incomingTitle = (lines[0] || '').replace(/^#+\s*/, '');
        incomingDesc = (lines[1] || '').replace(/^>\s*/, '');
    } else if (node) {
        // In Node mode, we rely on `node` object for meta, and sliced rawContent for body
        incomingTitle = node.text;
        incomingDesc = node.desc;
        
        const lines = rawContent.split('\n');
        incomingBody = lines.slice(2).join('\n');
    }

    // 1. Title
    // Only update if external source CHANGED from what we last saw
    // This prevents re-setting state when we are the ones who triggered the update (which might be "stale" relative to local state)
    if (incomingTitle !== lastExternalTitleRef.current) {
        lastExternalTitleRef.current = incomingTitle;
        if (editingField !== 'title' && incomingTitle !== titleRef.current) {
            setTitle(incomingTitle);
        }
    }

    // 2. Desc
    if (incomingDesc !== lastExternalDescRef.current) {
        lastExternalDescRef.current = incomingDesc;
        if (editingField !== 'desc' && incomingDesc !== descRef.current) {
            setDesc(incomingDesc);
        }
    }

    // 3. Body
    if (incomingBody !== lastExternalBodyRef.current) {
        lastExternalBodyRef.current = incomingBody;
        if (incomingBody !== bodyRef.current) {
            setBody(incomingBody);
        }
    }
    
    // Initialize refs on first run if null (prevents unnecessary mismatch on first render)
    if (lastExternalTitleRef.current === null) lastExternalTitleRef.current = incomingTitle;
    if (lastExternalDescRef.current === null) lastExternalDescRef.current = incomingDesc;
    if (lastExternalBodyRef.current === null) lastExternalBodyRef.current = incomingBody;

  }, [isRoot, node, rawContent, editingField]);

  const focusedNodeBody = useMemo(() => {
    if (!focusedNode) return '';
    const lines = focusedNodeRaw.split('\n');
    return lines.slice(2).join('\n');
  }, [focusedNode, focusedNodeRaw]);

  const isRootFocusDisplay = isRoot && state.ui.showFocusedRoot && !!focusedNode;
  const rootTextareaId = isRoot
    ? `${textareaId}-${isRootFocusDisplay ? `focus-${focusedNode?.id || 'none'}` : 'global'}`
    : textareaId;

  useEffect(() => {
    if (!isRoot) return;
    const incomingFocusedBody = focusedNodeBody;
    if (incomingFocusedBody !== lastExternalFocusedBodyRef.current) {
      lastExternalFocusedBodyRef.current = incomingFocusedBody;
      if (incomingFocusedBody !== focusedBodyRef.current) {
        setFocusedBody(incomingFocusedBody);
      }
    }
    if (lastExternalFocusedBodyRef.current === null) {
      lastExternalFocusedBodyRef.current = incomingFocusedBody;
    }
  }, [isRoot, focusedNodeBody]);

  // Reset selection tracking when switching to a different content source
  useEffect(() => {
    selectionRef.current = null;
    shouldRestoreSelectionRef.current = false;
  }, [contentKey, isRootFocusDisplay, focusedNode?.id, rootTextareaId]);

  // Input refs
  const titleInputRef = useRef<HTMLInputElement>(null);
  const descInputRef = useRef<HTMLInputElement>(null);

  // Focus management
  useEffect(() => {
    if (editingField === 'title' && titleInputRef.current) titleInputRef.current.focus();
    if (editingField === 'desc' && descInputRef.current) descInputRef.current.focus();
  }, [editingField]);

  // Clean up timeouts on unmount
  useEffect(() => {
    return () => {
        if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
        if (titleFastUpdateRef.current) clearTimeout(titleFastUpdateRef.current);
        if (descFastUpdateRef.current) clearTimeout(descFastUpdateRef.current);
    };
  }, []);

  // --- UPDATE HANDLERS ---
  
  const updateContent = useCallback((newTitle: string, newDesc: string, newBody: string) => {
      if (textReadOnly) return;
      const formattedTitle = `# ${newTitle}`;
      const formattedDesc = newDesc ? `> ${newDesc}` : ''; 
      const newFullContent = `${formattedTitle}\n${formattedDesc}\n${newBody}`;
      
      dispatch({ type: 'UPDATE_CONTENT', payload: { id: contentKey, content: newFullContent } });

      // We also update meta here to ensure consistency, though fast track might have already done it
      if (!isRoot && nodeId) {
          dispatch({ 
              type: 'UPDATE_NODE_META', 
              payload: { id: nodeId, text: newTitle, desc: newDesc } 
          });
      }
  }, [contentKey, isRoot, nodeId, dispatch, textReadOnly]);

  // Real-time Title Change Handler
  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      if (textReadOnly) return;
      const val = e.target.value;
      setTitle(val);

      // 1. Fast Track: Update Outline/Breadcrumbs quickly (100ms)
      if (titleFastUpdateRef.current) clearTimeout(titleFastUpdateRef.current);
      titleFastUpdateRef.current = setTimeout(() => {
           if (!isRoot && nodeId) {
               dispatch({ type: 'UPDATE_NODE_META', payload: { id: nodeId, text: val } });
           }
           titleFastUpdateRef.current = null;
      }, 100);

      // 2. Slow Track: Update Full Content / Storage (700ms)
      if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
      updateTimeoutRef.current = setTimeout(() => {
          updateContent(val, descRef.current, bodyRef.current);
          updateTimeoutRef.current = null;
      }, 700);
  }, [isRoot, nodeId, dispatch, updateContent, textReadOnly]);

  // Real-time Description Change Handler
  const handleDescChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      if (textReadOnly) return;
      const val = e.target.value;
      setDesc(val);

      // 1. Fast Track
      if (descFastUpdateRef.current) clearTimeout(descFastUpdateRef.current);
      descFastUpdateRef.current = setTimeout(() => {
           if (!isRoot && nodeId) {
               dispatch({ type: 'UPDATE_NODE_META', payload: { id: nodeId, desc: val } });
           }
           descFastUpdateRef.current = null;
      }, 100);

      // 2. Slow Track
      if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
      updateTimeoutRef.current = setTimeout(() => {
          updateContent(titleRef.current, val, bodyRef.current);
          updateTimeoutRef.current = null;
      }, 700);
  }, [isRoot, nodeId, dispatch, updateContent, textReadOnly]);


  // Commit handlers (Enter/Blur) - Force immediate update
  const handleTitleCommit = useCallback(() => {
      if (textReadOnly) return;
      setEditingField(null);
      // Clear pending timeouts to avoid overwriting the immediate commit
      if (titleFastUpdateRef.current) clearTimeout(titleFastUpdateRef.current);
      if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
      
      updateContent(title, desc, body);
  }, [title, desc, body, updateContent, textReadOnly]);

  const handleDescCommit = useCallback(() => {
      if (textReadOnly) return;
      setEditingField(null);
      if (descFastUpdateRef.current) clearTimeout(descFastUpdateRef.current);
      if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);

      updateContent(title, desc, body);
  }, [title, desc, body, updateContent, textReadOnly]);

  // Debounced Body Change
  const handleBodyChange = useCallback((val: string) => {
      if (textReadOnly) return;
      const textarea = document.getElementById(rootTextareaId) as HTMLTextAreaElement | null;
      if (textarea && !skipSelectionCaptureRef.current) {
          selectionRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd };
          shouldRestoreSelectionRef.current = true;
      }
      skipSelectionCaptureRef.current = false;
      setBody(val);
      
      if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
      
      updateTimeoutRef.current = setTimeout(() => {
          // Use refs to ensure latest title/desc are used
          updateContent(titleRef.current, descRef.current, val);
          updateTimeoutRef.current = null;
      }, 700);
  }, [updateContent, textReadOnly]);

  // Debounced Raw Change (for Root)
  const handleRawChange = useCallback((val: string) => {
      if (textReadOnly) return;
      const textarea = document.getElementById(rootTextareaId) as HTMLTextAreaElement | null;
      if (textarea && !skipSelectionCaptureRef.current) {
          selectionRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd };
          shouldRestoreSelectionRef.current = true;
      }
      skipSelectionCaptureRef.current = false;
      setBody(val);
      
      if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
      
      updateTimeoutRef.current = setTimeout(() => {
          dispatch({ type: 'UPDATE_CONTENT', payload: { id: contentKey, content: val } });
          updateTimeoutRef.current = null;
      }, 700);
  }, [contentKey, dispatch, textReadOnly]);

  const handleFocusedBodyChange = useCallback((val: string) => {
      if (textReadOnly) return;
      if (!focusedNode) return;
      const textarea = document.getElementById(textareaId) as HTMLTextAreaElement | null;
      if (textarea && !skipSelectionCaptureRef.current) {
          selectionRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd };
          shouldRestoreSelectionRef.current = true;
      }
      skipSelectionCaptureRef.current = false;
      setFocusedBody(val);

      if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);

      updateTimeoutRef.current = setTimeout(() => {
          const formattedTitle = `# ${focusedNode.text || ''}`;
          const formattedDesc = focusedNode.desc ? `> ${focusedNode.desc}` : '';
          const newFullContent = `${formattedTitle}\n${formattedDesc}\n${val}`;
          dispatch({ type: 'UPDATE_CONTENT', payload: { id: focusedNode.id, content: newFullContent } });
          updateTimeoutRef.current = null;
      }, 700);
  }, [focusedNode, dispatch, rootTextareaId, textReadOnly]);

  const restoreSelection = useCallback(() => {
      if (!shouldRestoreSelectionRef.current) return;
      const textarea = document.getElementById(rootTextareaId) as HTMLTextAreaElement | null;
      if (!textarea) return;
      const sel = selectionRef.current;
      if (!sel) return;
      const len = textarea.value.length;
      const start = Math.min(sel.start, len);
      const end = Math.min(sel.end, len);
      textarea.selectionStart = start;
      textarea.selectionEnd = end;
      shouldRestoreSelectionRef.current = false;
  }, [rootTextareaId]);

  // Restore selection after controlled updates (fix Ctrl+Z cursor jump)
  useLayoutEffect(() => {
      restoreSelection();
      if (!shouldRestoreSelectionRef.current) return;
      const raf = requestAnimationFrame(() => restoreSelection());
      return () => cancelAnimationFrame(raf);
  }, [body, focusedBody, restoreSelection]);

  // Save immediately on blur
  const handleEditorBlur = useCallback(() => {
      if (textReadOnly) return;
      if (updateTimeoutRef.current) {
          clearTimeout(updateTimeoutRef.current);
          updateTimeoutRef.current = null;
          if (isRoot) {
               if (isRootFocusDisplay && focusedNode) {
                    const formattedTitle = `# ${focusedNode.text || ''}`;
                    const formattedDesc = focusedNode.desc ? `> ${focusedNode.desc}` : '';
                    const newFullContent = `${formattedTitle}\n${formattedDesc}\n${focusedBodyRef.current}`;
                    dispatch({ type: 'UPDATE_CONTENT', payload: { id: focusedNode.id, content: newFullContent } });
               } else {
                    dispatch({ type: 'UPDATE_CONTENT', payload: { id: contentKey, content: body } });
               }
          } else {
               updateContent(titleRef.current, descRef.current, body);
          }
      }
  }, [isRoot, isRootFocusDisplay, focusedNode, contentKey, body, updateContent, dispatch, textReadOnly]);

  // --- NODE IMPORT / EXPORT HANDLERS ---
  
  const handleNodeExport = () => {
    // Support export for both Node and Root
    const contentToExport = isRoot ? rawContent : rawContent;
    
    // For Root, we don't have a 'node' object, so we construct a filename
    let filename = 'untitled.md';
    if (isRoot) {
        filename = `Global_Context_${formatDateForFilename(new Date())}.md`;
    } else if (node) {
        const name = node.text || 'Untitled';
        const date = new Date(node.lastModified);
        filename = `${sanitizeFilename(name)}_${formatDateForFilename(date)}.md`;
    } else {
        return; 
    }

    saveFile(contentToExport, filename, 'text/markdown');
  };

  const handleNodeImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await readTextFile(file);
      if (text) {
          // Check if current node is empty
          // In Root mode, title is empty string, so we check body (rawContent)
          const isNodeEmpty = !title.trim() && !body.trim();

          // 1. Handle Title (Programmatic State Update is fine for Title)
          // Only for Node mode do we auto-set title from filename if empty
          if (!isRoot && isNodeEmpty) {
              const newTitle = file.name.replace(/\.[^/.]+$/, "");
              setTitle(newTitle);
              if (nodeId) {
                  dispatch({ 
                      type: 'UPDATE_NODE_META', 
                      payload: { id: nodeId, text: newTitle, desc: descRef.current } 
                  });
              }
          }

          // 2. Handle Body via execCommand to preserve Undo History
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
                const success = document.execCommand('insertText', false, insertText);
                
                if (!success) {
                    // Fallback
                    const newBody = isNodeEmpty ? text : (body + '\n\n' + text);
                    setBody(newBody);
                    
                    // Critical Fix: For Root mode, use dispatch directly to avoid prepending # and > 
                    if (isRoot) {
                         dispatch({ type: 'UPDATE_CONTENT', payload: { id: contentKey, content: newBody } });
                    } else {
                         updateContent(title, desc, newBody);
                    }
                }
          }
      }
    } catch (err: any) {
      console.error('Failed to import text file:', err);
      alert(err?.message || 'Failed to import file.');
    } finally {
      e.target.value = ''; // Reset input
    }
  };

  // --- SHORTCUTS & FORMATTING ---
  const insertFormat = useCallback((
    textarea: HTMLTextAreaElement, 
    prefix: string, 
    suffix: string, 
    placeholder: string = 'text'
  ) => {
    if (textReadOnly) return;
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
  }, [isRoot, contentKey, dispatch, updateContent, textReadOnly]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (textReadOnly) return;
    // Only handle if Ctrl or Meta (Cmd) is pressed
    if (!e.ctrlKey && !e.metaKey) return;

    // Use currentTarget to ensure we get the wrapper or element we attached to, 
    // but insertFormat needs the textarea. 
    // e.target is the textarea in simple-code-editor.
    const textarea = e.target as HTMLTextAreaElement;
    if (textarea.tagName !== 'TEXTAREA') return;

    const key = e.key.toLowerCase();
    const isUndo = key === 'z' && !e.shiftKey && !e.altKey;
    const isRedo = (key === 'z' && e.shiftKey) || key === 'y';
    if (isUndo || isRedo) {
        selectionRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd };
        shouldRestoreSelectionRef.current = true;
        skipSelectionCaptureRef.current = true;
    }
    
    switch(key) {
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
  }, [insertFormat, textReadOnly]);

  // Memoized highlight function to prevent cursor jumping on re-render/undo
  const highlightWithPrism = useCallback((code: string) => Prism.highlight(code, grammar, 'markdown'), []);

  // Stable Style Object
  const editorStyle = useMemo(() => ({ 
        fontFamily: '"Menlo", "Monaco", "Courier New", monospace',
        minHeight: '100%',
        lineHeight: '1.625'
  }), []);

  const rootDisplayContent = isRootFocusDisplay ? focusedBody : body;
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const editorRootRef = useRef<HTMLDivElement>(null);
  const isPointerInsideRef = useRef(false);
  const previewMarkdown = isRoot ? rootDisplayContent : body;

  const previewHeadings = useMemo(() => {
    const all = parsePreviewHeadings(previewMarkdown);
    return all.filter(item => item.level <= 3).slice(0, 24);
  }, [previewMarkdown]);

  const previewHotzoneRef = useRef<HTMLDivElement>(null);
  const previewOutlinePanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isPreview || previewHeadings.length === 0) {
      setIsPreviewOutlineOpen(false);
    }
  }, [isPreview, previewHeadings.length]);

  const handlePreviewHotzoneLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && previewOutlinePanelRef.current?.contains(next)) return;
    setIsPreviewOutlineOpen(false);
  };

  const handlePreviewPanelLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && previewHotzoneRef.current?.contains(next)) return;
    setIsPreviewOutlineOpen(false);
  };

  const handleOutlineJump = useCallback((domIndex: number) => {
    const container = previewScrollRef.current;
    if (!container) return;
    const headingEls = container.querySelectorAll('.markdown-preview h1, .markdown-preview h2, .markdown-preview h3, .markdown-preview h4, .markdown-preview h5, .markdown-preview h6');
    const target = headingEls[domIndex] as HTMLElement | undefined;
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  useEffect(() => {
    const handlePreviewShortcut = (e: KeyboardEvent) => {
      if (textReadOnly) return;
      if ((!e.ctrlKey && !e.metaKey) || !e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== 'v') return;

      const activeElement = document.activeElement;
      const hasFocusInside = !!activeElement && !!editorRootRef.current?.contains(activeElement);
      const isTargetEditor = hasFocusInside || isPointerInsideRef.current;
      if (!isTargetEditor) return;

      e.preventDefault();
      e.stopPropagation();
      setIsPreview((preview) => !preview);
    };

    window.addEventListener('keydown', handlePreviewShortcut);
    return () => window.removeEventListener('keydown', handlePreviewShortcut);
  }, [isPreview, textReadOnly]);

  const handlePreviewDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsPreview(false);
  }, []);

  // --- RENDER ---
  if (!isRoot && (!nodeId || !node)) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 dark:text-gray-600 bg-white/62 dark:bg-zinc-950/62 backdrop-blur-sm">
        <div className="text-center">
            <p className="text-lg font-medium">Select a node</p>
            <p className="text-sm mt-2">Choose an item from the outline.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={editorRootRef}
      tabIndex={-1}
      className="h-full flex flex-col bg-white/62 dark:bg-zinc-950/62 backdrop-blur-sm relative group transition-colors"
      onMouseEnter={() => {
        isPointerInsideRef.current = true;
      }}
      onMouseLeave={() => {
        isPointerInsideRef.current = false;
      }}
    >
      {/* Hidden File Input for Import */}
      <input type="file" ref={fileInputRef} onChange={handleNodeImport} accept=".md,.txt" className="hidden" />

      {/* Toolbar */}
      <div className="absolute top-2 right-4 z-10 flex items-center gap-2">
          <span className="text-[10px] text-[color:var(--flow-accent-muted)] uppercase font-bold tracking-widest border border-gray-100 dark:border-zinc-800 px-2 py-1 rounded select-none transition-colors">
              {textReadOnly ? 'TEXT READ ONLY' : isRoot ? 'GLOBAL CONTEXT' : 'DETAIL EDITOR'}
          </span>
          {isRoot && (
            <button
              onClick={() => dispatch({ type: 'TOGGLE_ROOT_FOCUS_VIEW' })}
              disabled={!focusedNode}
              className={`px-2 py-1 text-[10px] font-medium rounded border transition-colors ${focusedNode ? 'text-[color:var(--flow-accent-muted)] hover:text-[color:var(--flow-accent)] border-[color:var(--flow-accent-border)] bg-[color:var(--flow-accent-soft)]/60 dark:border-zinc-800 dark:bg-zinc-900/80' : 'text-gray-300 dark:text-zinc-600 border-gray-100 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 cursor-not-allowed'}`}
              title={focusedNode ? (isRootFocusDisplay ? 'Show Global Context' : 'Show Focused Node') : 'No focused node'}
            >
              {isRootFocusDisplay ? '显示全局' : '显示聚焦'}
            </button>
          )}
          <button
            onClick={() => setIsPreview(!isPreview)}
            className="p-1.5 text-gray-400 hover:text-[color:var(--flow-accent)] hover:bg-[color:var(--flow-accent-soft)] rounded-md transition-colors bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm border border-gray-100 dark:border-zinc-800 shadow-sm"
            title={isPreview ? "Switch to Edit Mode" : "Switch to Preview Mode"}
          >
            {isPreview ? <IconEdit className="w-4 h-4" /> : <IconEye className="w-4 h-4" />}
          </button>
      </div>

      {isPreview && previewHeadings.length > 0 && (
        <>
          <div
            ref={previewHotzoneRef}
            className="hidden xl:block absolute right-0 top-0 bottom-0 w-6 z-20"
            onMouseEnter={() => setIsPreviewOutlineOpen(true)}
            onMouseLeave={handlePreviewHotzoneLeave}
          />
          {isPreviewOutlineOpen && (
            <aside
              ref={previewOutlinePanelRef}
              className="hidden xl:block absolute right-4 top-1/2 -translate-y-1/2 z-30"
              onMouseEnter={() => setIsPreviewOutlineOpen(true)}
              onMouseLeave={handlePreviewPanelLeave}
            >
              <div className="w-52 rounded-lg border border-[color:var(--flow-accent-border)]/60 dark:border-zinc-800 bg-white/88 dark:bg-zinc-900/88 backdrop-blur-sm px-3 py-2 shadow-sm">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-[color:var(--flow-accent-muted)] dark:text-[color:var(--flow-accent-muted)] mb-2 transition-colors">Outline</div>
                <div className="space-y-1 max-h-[60vh] overflow-auto">
                  {previewHeadings.map((item) => (
                    <button
                      key={`${item.domIndex}-${item.text}`}
                      onClick={() => handleOutlineJump(item.domIndex)}
                      className={`block w-full text-left text-xs leading-5 text-gray-500 dark:text-zinc-400 hover:text-[color:var(--flow-accent)] truncate ${item.level === 1 ? '' : item.level === 2 ? 'pl-2' : 'pl-4'}`}
                      title={item.text}
                    >
                      {item.text}
                    </button>
                  ))}
                </div>
              </div>
            </aside>
          )}
        </>
      )}

      <div ref={previewScrollRef} className="flex-1 overflow-y-auto relative flex flex-col">
        {isRoot ? (
            // --- ROOT MODE ---
            isPreview ? (
                <div className="w-full h-full p-8">
                    <div className="mx-auto w-full max-w-4xl">
                        <article
                            className="markdown-preview prose prose-sm sm:prose-base max-w-none dark:prose-invert"
                            onDoubleClick={handlePreviewDoubleClick}
                        >
                            <Markdown rehypePlugins={[rehypeRaw]}>{rootDisplayContent || '*No content*'}</Markdown>
                        </article>
                    </div>
                </div>
            ) : (
                <div className="w-full min-h-full p-8 mx-auto max-w-4xl">
                    <div className="prism-editor-wrapper h-full">
                        <Editor
                            key={isRootFocusDisplay ? `root-focus-${focusedNode?.id || 'none'}` : 'root-global'}
                            value={rootDisplayContent}
                            textareaId={rootTextareaId}
                            onValueChange={isRootFocusDisplay ? handleFocusedBodyChange : handleRawChange}
                            onBlur={handleEditorBlur}
                            highlight={highlightWithPrism}
                            padding={0}
                            onKeyDown={handleKeyDown}
                            readOnly={textReadOnly}
                            className="font-mono text-lg text-gray-800 dark:text-gray-200 min-h-[400px]"
                            textareaClassName={`focus:outline-none selection:bg-[color:var(--flow-accent-soft)] selection:text-[color:var(--flow-accent-strong)] ${textReadOnly ? 'cursor-default' : ''}`}
                            style={editorStyle}
                        />
                    </div>
                </div>
            )
        ) : (
            // --- NODE MODE ---
            <div className="flex flex-col min-h-full p-8 mx-auto w-full max-w-4xl">
                
                {/* Header Section */}
                <div className="mb-2 flex items-end justify-between gap-4">
                    <div className="flex-1 min-w-0">
                        {!textReadOnly && editingField === 'title' ? (
                            <input
                                ref={titleInputRef}
                                type="text"
                                value={title}
                                onChange={handleTitleChange}
                                onBlur={handleTitleCommit}
                                onKeyDown={(e) => e.key === 'Enter' && handleTitleCommit()}
                                placeholder="Untitled Node"
                                className="w-full text-3xl font-bold text-gray-900 dark:text-gray-100 placeholder-gray-300 dark:placeholder-zinc-600 border-none focus:ring-0 focus:outline-none bg-transparent p-0"
                            />
                        ) : (
                            <h1 
                                className={`text-3xl font-bold p-0 select-none ${textReadOnly ? 'cursor-default' : 'cursor-text'} ${title ? 'text-gray-900 dark:text-gray-100' : 'text-gray-300 dark:text-zinc-600'}`}
                                onDoubleClick={() => {
                                    if (!textReadOnly) setEditingField('title');
                                }}
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

                        <div className="flex items-center bg-white/70 dark:bg-zinc-800/90 rounded-lg border border-[color:var(--flow-accent-border)]/60 dark:border-zinc-700 p-0.5 opacity-70 hover:opacity-100 transition-opacity mt-1">
                            <button 
                                onClick={handleNodeExport} 
                                className="p-1 hover:bg-[color:var(--flow-accent-soft)] dark:hover:bg-zinc-700 rounded text-gray-500 hover:text-[color:var(--flow-accent)] transition-colors" 
                                title="Export Node Markdown"
                            >
                                <IconDownload className="w-4 h-4" />
                            </button>
                            <button 
                                onClick={() => fileInputRef.current?.click()} 
                                className="p-1 hover:bg-[color:var(--flow-accent-soft)] dark:hover:bg-zinc-700 rounded text-gray-500 hover:text-[color:var(--flow-accent)] transition-colors" 
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
                        {!textReadOnly && editingField === 'desc' ? (
                            <input
                                ref={descInputRef}
                                type="text"
                                value={desc}
                                onChange={handleDescChange}
                                onBlur={handleDescCommit}
                                onKeyDown={(e) => e.key === 'Enter' && handleDescCommit()}
                                placeholder="Add a brief description..."
                                className="w-full text-lg text-gray-500 dark:text-gray-400 placeholder-gray-300 dark:placeholder-zinc-600 border-none focus:ring-0 focus:outline-none bg-transparent p-0"
                            />
                        ) : (
                            <p 
                                className={`text-lg p-0 select-none ${textReadOnly ? 'cursor-default' : 'cursor-text'} ${desc ? 'text-gray-500 dark:text-gray-400' : 'text-gray-300 dark:text-zinc-600 italic'}`}
                                onDoubleClick={() => {
                                    if (!textReadOnly) setEditingField('desc');
                                }}
                            >
                                {desc || 'Double-click to add description...'}
                            </p>
                        )}
                    </div>
                )}

                <div className="w-full h-px bg-gray-100 dark:bg-zinc-800 my-6" />

                {/* Body / Editor */}
                {isPreview ? (
                    <div>
                        <article
                            className="markdown-preview prose prose-sm sm:prose-base max-w-none dark:prose-invert"
                            onDoubleClick={handlePreviewDoubleClick}
                        >
                            <Markdown rehypePlugins={[rehypeRaw]}>{body || '*No content*'}</Markdown>
                        </article>
                    </div>
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
                            readOnly={textReadOnly}
                            className="font-mono text-lg text-gray-800 dark:text-gray-200 min-h-[400px]"
                            textareaClassName={`focus:outline-none selection:bg-[color:var(--flow-accent-soft)] selection:text-[color:var(--flow-accent-strong)] ${textReadOnly ? 'cursor-default' : ''}`}
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
