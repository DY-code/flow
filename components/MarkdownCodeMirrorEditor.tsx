import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { history, historyKeymap, defaultKeymap, indentLess, indentMore } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language';
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  Extension,
  Prec,
  Range,
  StateEffect,
  StateField,
} from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  keymap,
  WidgetType,
} from '@codemirror/view';

export interface MarkdownCodeMirrorEditorHandle {
  focus: () => void;
  insertText: (text: string, options?: { replaceAll?: boolean; atEnd?: boolean }) => void;
}

interface MarkdownCodeMirrorEditorProps {
  value: string;
  foldScopeKey: string;
  readOnly?: boolean;
  className?: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
}

interface MarkdownFoldSection {
  key: string;
  title: string;
  headingFrom: number;
  from: number;
  to: number;
  hiddenLineCount: number;
}

interface MarkdownFoldFieldState {
  collapsedKeys: Set<string>;
  decorations: DecorationSet;
}

// CodeMirror-backed Markdown editor with display-layer heading folding.
// Fold placeholders are widgets, not document text, so hidden content is not editable.
const MARKDOWN_HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const externalValueSync = Annotation.define<boolean>();
const toggleMarkdownFold = StateEffect.define<string>();

const stripMarkdownInline = (text: string): string => {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/<[^>]+>/g, '')
    .trim();
};

const parseMarkdownFoldSections = (state: EditorState, scopeKey: string): MarkdownFoldSection[] => {
  const headings: Array<{ level: number; title: string; lineNumber: number; from: number }> = [];

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    const match = line.text.match(MARKDOWN_HEADING_PATTERN);
    if (!match) continue;
    const title = stripMarkdownInline(match[2]);
    if (!title) continue;
    headings.push({
      level: match[1].length,
      title,
      lineNumber,
      from: line.from,
    });
  }

  return headings
    .map((heading, index) => {
      const nextBoundary = headings
        .slice(index + 1)
        .find((candidate) => candidate.level <= heading.level);
      const firstHiddenLineNumber = heading.lineNumber + 1;
      const lastHiddenLineNumber = nextBoundary
        ? nextBoundary.lineNumber - 1
        : state.doc.lines;
      const hiddenLineCount = lastHiddenLineNumber - heading.lineNumber;
      if (hiddenLineCount <= 0 || firstHiddenLineNumber > state.doc.lines) return null;

      const firstHiddenLine = state.doc.line(firstHiddenLineNumber);
      const to = nextBoundary ? state.doc.line(lastHiddenLineNumber).to : state.doc.length;
      if (firstHiddenLine.from >= to) return null;

      return {
        key: `${scopeKey}:${heading.lineNumber}:${heading.level}:${heading.title}`,
        title: heading.title,
        headingFrom: heading.from,
        from: firstHiddenLine.from,
        to,
        hiddenLineCount,
      };
    })
    .filter((section): section is MarkdownFoldSection => Boolean(section));
};

const selectionTouchesRange = (state: EditorState, from: number, to: number): boolean => {
  return state.selection.ranges.some((range) => {
    if (range.empty) return range.from >= from && range.from <= to;
    return range.from < to && range.to > from;
  });
};

class FoldToggleWidget extends WidgetType {
  constructor(
    private readonly section: MarkdownFoldSection,
    private readonly collapsed: boolean
  ) {
    super();
  }

  eq(other: FoldToggleWidget): boolean {
    return other.section.key === this.section.key && other.collapsed === this.collapsed;
  }

  toDOM(view: EditorView): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-markdown-fold-toggle';
    button.dataset.collapsed = String(this.collapsed);
    button.title = this.collapsed ? '展开' : '折叠';
    button.setAttribute('aria-label', `${this.collapsed ? '展开' : '折叠'} ${this.section.title}`);
    button.contentEditable = 'false';

    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const shouldBlur = !this.collapsed && selectionTouchesRange(view.state, this.section.from, this.section.to);
      view.dispatch({ effects: toggleMarkdownFold.of(this.section.key) });
      if (shouldBlur) {
        requestAnimationFrame(() => view.contentDOM.blur());
      }
    });

    return button;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class FoldPlaceholderWidget extends WidgetType {
  constructor(private readonly section: MarkdownFoldSection) {
    super();
  }

  eq(other: FoldPlaceholderWidget): boolean {
    return other.section.key === this.section.key &&
      other.section.hiddenLineCount === this.section.hiddenLineCount;
  }

  toDOM(view: EditorView): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-markdown-fold-placeholder';
    button.textContent = `... 已折叠 ${this.section.hiddenLineCount} 行`;
    button.title = '展开折叠内容';
    button.contentEditable = 'false';

    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({ effects: toggleMarkdownFold.of(this.section.key) });
    });

    return button;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

const buildFoldDecorations = (
  state: EditorState,
  collapsedKeys: Set<string>,
  scopeKey: string
): DecorationSet => {
  const ranges: Range<Decoration>[] = [];
  const sections = parseMarkdownFoldSections(state, scopeKey);

  sections.forEach((section) => {
    const collapsed = collapsedKeys.has(section.key);
    ranges.push(Decoration.widget({
      widget: new FoldToggleWidget(section, collapsed),
      side: -1,
    }).range(section.headingFrom));

    if (!collapsed) return;
    ranges.push(Decoration.replace({
      widget: new FoldPlaceholderWidget(section),
      block: true,
    }).range(section.from, section.to));
  });

  return Decoration.set(ranges, true);
};

const buildFormatStyleDecorations = (state: EditorState): DecorationSet => {
  const source = state.doc.toString();
  const ranges: Range<Decoration>[] = [];

  const addMatches = (pattern: RegExp, className: string) => {
    for (const match of source.matchAll(pattern)) {
      const from = match.index ?? 0;
      const to = from + match[0].length;
      if (to <= from) continue;
      ranges.push(Decoration.mark({ class: className }).range(from, to));
    }
  };

  addMatches(/~~(?:(?!~~)[\s\S])+~~/g, 'cm-format-strike');
  addMatches(/<u\b[^>]*>[\s\S]*?<\/u>/gi, 'cm-format-underline');

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    if (/^\s{0,3}(?:-{3,}|\*{3,})\s*$/.test(line.text)) {
      ranges.push(Decoration.mark({ class: 'cm-markdown-horizontal-rule' }).range(line.from, line.to));
    }

    if (/^\s{0,3}[-+*]\s*$/.test(line.text)) {
      ranges.push(Decoration.mark({ class: 'cm-markdown-single-symbol' }).range(line.from, line.to));
    }

    const listMarkerMatch = line.text.match(/^(\s*)[-+*]\s+/);
    if (listMarkerMatch) {
      const markerFrom = line.from + listMarkerMatch[1].length;
      const markerTo = markerFrom + listMarkerMatch[0].length - listMarkerMatch[1].length;
      ranges.push(Decoration.mark({ class: 'cm-markdown-list-marker' }).range(markerFrom, markerTo));
    }
  }

  return Decoration.set(ranges, true);
};

const markdownFormatStyleField = StateField.define<DecorationSet>({
  create: buildFormatStyleDecorations,
  update(value, transaction) {
    return transaction.docChanged ? buildFormatStyleDecorations(transaction.state) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const markdownFoldExtensions = (scopeKey: string): Extension => {
  const foldField = StateField.define<MarkdownFoldFieldState>({
    create(state) {
      const collapsedKeys = new Set<string>();
      return {
        collapsedKeys,
        decorations: buildFoldDecorations(state, collapsedKeys, scopeKey),
      };
    },
    update(value, transaction) {
      let collapsedKeys = value.collapsedKeys;
      let changed = transaction.docChanged;

      for (const effect of transaction.effects) {
        if (!effect.is(toggleMarkdownFold)) continue;
        collapsedKeys = new Set(collapsedKeys);
        if (collapsedKeys.has(effect.value)) {
          collapsedKeys.delete(effect.value);
        } else {
          collapsedKeys.add(effect.value);
        }
        changed = true;
      }

      if (!changed) return value;
      return {
        collapsedKeys,
        decorations: buildFoldDecorations(transaction.state, collapsedKeys, scopeKey),
      };
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
  });

  const protectCollapsedContent = EditorState.transactionFilter.of((transaction) => {
    if (!transaction.docChanged || transaction.annotation(externalValueSync)) return transaction;

    const currentFoldState = transaction.startState.field(foldField, false);
    if (!currentFoldState || currentFoldState.collapsedKeys.size === 0) return transaction;

    const collapsedSections = parseMarkdownFoldSections(transaction.startState, scopeKey)
      .filter((section) => currentFoldState.collapsedKeys.has(section.key));
    if (collapsedSections.length === 0) return transaction;

    let touchesCollapsedContent = false;
    transaction.changes.iterChangedRanges((fromA, toA) => {
      if (touchesCollapsedContent) return;
      touchesCollapsedContent = collapsedSections.some((section) => {
        const overlapsRange = fromA < section.to && toA > section.from;
        const insertsInsideRange = fromA === toA && fromA > section.from && fromA < section.to;
        return overlapsRange || insertsInsideRange;
      });
    });

    return touchesCollapsedContent ? [] : transaction;
  });

  return [foldField, protectCollapsedContent];
};

const wrapSelection = (
  view: EditorView,
  prefix: string,
  suffix: string,
  placeholder = 'text'
): boolean => {
  if (view.state.readOnly) return true;
  const selection = view.state.selection.main;
  const selected = view.state.sliceDoc(selection.from, selection.to);
  const before = selection.from >= prefix.length
    ? view.state.sliceDoc(selection.from - prefix.length, selection.from)
    : '';
  const after = selection.to + suffix.length <= view.state.doc.length
    ? view.state.sliceDoc(selection.to, selection.to + suffix.length)
    : '';

  if (before === prefix && after === suffix) {
    view.dispatch({
      changes: [
        { from: selection.to, to: selection.to + suffix.length, insert: '' },
        { from: selection.from - prefix.length, to: selection.from, insert: '' },
      ],
      selection: EditorSelection.range(
        selection.from - prefix.length,
        selection.from - prefix.length + selected.length
      ),
      scrollIntoView: true,
    });
    return true;
  }

  const content = selected || placeholder;
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: `${prefix}${content}${suffix}` },
    selection: EditorSelection.range(
      selection.from + prefix.length,
      selection.from + prefix.length + content.length
    ),
    scrollIntoView: true,
  });
  return true;
};

const createFormatKeymap = (): Extension => keymap.of([
  { key: 'Tab', preventDefault: true, run: indentMore },
  { key: 'Shift-Tab', preventDefault: true, run: indentLess },
  { key: 'Mod-b', preventDefault: true, run: (view) => wrapSelection(view, '**', '**', 'bold') },
  { key: 'Mod-i', preventDefault: true, run: (view) => wrapSelection(view, '*', '*', 'italic') },
  { key: 'Mod-u', preventDefault: true, run: (view) => wrapSelection(view, '<u>', '</u>', 'underline') },
  { key: 'Mod-Shift-x', preventDefault: true, run: (view) => wrapSelection(view, '~~', '~~', 'strike') },
  {
    key: 'Mod-k',
    preventDefault: true,
    run: (view) => {
      const selection = view.state.selection.main;
      const selected = view.state.sliceDoc(selection.from, selection.to);
      return selected
        ? wrapSelection(view, '[', '](url)')
        : wrapSelection(view, '[', '](url)', 'text');
    },
  },
]);

const readOnlyExtensions = (readOnly: boolean): Extension => [
  EditorState.readOnly.of(readOnly),
  EditorView.editable.of(!readOnly),
];

const MarkdownCodeMirrorEditor = forwardRef<MarkdownCodeMirrorEditorHandle, MarkdownCodeMirrorEditorProps>(({
  value,
  foldScopeKey,
  readOnly = false,
  className = '',
  onChange,
  onBlur,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  const readOnlyCompartmentRef = useRef(new Compartment());

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onBlurRef.current = onBlur;
  }, [onBlur]);

  useImperativeHandle(ref, () => ({
    focus: () => {
      viewRef.current?.focus();
    },
    insertText: (text, options = {}) => {
      const view = viewRef.current;
      if (!view || view.state.readOnly) return;
      const docLength = view.state.doc.length;
      const selection = view.state.selection.main;
      const from = options.replaceAll ? 0 : options.atEnd ? docLength : selection.from;
      const to = options.replaceAll ? docLength : options.atEnd ? docLength : selection.to;
      view.focus();
      view.dispatch({
        changes: { from, to, insert: text },
        selection: EditorSelection.cursor(from + text.length),
        scrollIntoView: true,
      });
    },
  }), []);

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        markdown(),
        indentUnit.of('  '),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        EditorView.lineWrapping,
        Prec.high(markdownFormatStyleField),
        createFormatKeymap(),
        keymap.of([...historyKeymap, ...defaultKeymap]),
        markdownFoldExtensions(foldScopeKey),
        readOnlyCompartmentRef.current.of(readOnlyExtensions(readOnly)),
        EditorView.domEventHandlers({
          blur: () => {
            onBlurRef.current?.();
          },
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          const isExternalSync = update.transactions.some((transaction) => transaction.annotation(externalValueSync));
          if (!isExternalSync) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [foldScopeKey]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure(readOnlyExtensions(readOnly)),
    });
  }, [readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentValue = view.state.doc.toString();
    if (currentValue === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: externalValueSync.of(true),
    });
  }, [value]);

  return <div ref={containerRef} className={`markdown-codemirror-editor ${className}`} />;
});

MarkdownCodeMirrorEditor.displayName = 'MarkdownCodeMirrorEditor';

export default MarkdownCodeMirrorEditor;
