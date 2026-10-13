import { useEffect, useRef, useState } from 'react';
import {
  createDocument,
  EditorContent,
  Extension,
  useEditor,
  useEditorState,
  type Editor,
  type UseEditorOptions,
} from '@tiptap/react';
import { Fragment, Slice, type Node as PmNode, type ResolvedPos } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { CellSelection, cellAround } from '@tiptap/pm/tables';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { useT } from '@/i18n';
import messages from '@/i18n/messages/richText';
import {
  fromEditorHtml,
  joinPage,
  pageStyle,
  preparePastedHtml,
  readableOn,
  sanitizeHtml,
  splitPage,
  stripTableDefaults,
  textColorFor,
  type PageColors,
  toEditorHtml,
} from '../../lib/rich-html';
import {
  EditorShell,
  LinkBubble,
  RichToolbar,
  type BlockType,
  type ColorPair,
  type LinkAdapter,
  type TextAlign as Align,
  type ToolbarActions,
  type ToolbarShortcuts,
  type ToolbarState,
} from './editor-chrome';
import type { RichLang as Lang } from './lang-tabs';
import { TableBubble, type TableActions, type TableState } from './table-chrome';
import { currentCellPos, emptyCells, firstRowIsHeader, splitCell } from './tiptap-table';
import { BOX, BOX_BORDER, boxAround, unwrapBox, wrapInBox } from './tiptap-box';
import type { RichEditorProps } from './types';
import { HEADINGS, schemaExtensions } from './schema';

/**
 * Plain-text paste (Telegram, Notepad, Ctrl+Shift+V). ProseMirror makes every line a
 * paragraph and drops blank lines; here a blank line starts a new paragraph and a
 * single line break stays a `<br>`. Runs of spaces collapse, as they would anyway
 * once the HTML is shown, so what is stored is what reloads.
 */
function plainTextToSlice(text: string, $context: ResolvedPos, _plain: boolean, view: EditorView) {
  const { schema } = view.state;
  const normalized = text.replace(/\r\n?/g, '\n');
  // Inside a code block the newlines and spaces are the content.
  if ($context.parent.type.spec.code) {
    return normalized ? new Slice(Fragment.from(schema.text(normalized)), 0, 0) : Slice.empty;
  }
  // A copied line usually ends in a newline; it is not a line break the admin wants.
  const body = normalized.replace(/\n+$/, '');
  if (!body.trim()) {
    // Only whitespace: one space, so pasting it over a selection does not just delete.
    return body ? new Slice(Fragment.from(schema.text(' ')), 0, 0) : Slice.empty;
  }
  const paragraphs = body
    .split(/\n[ \t]*\n+/)
    .filter((block) => block.trim() !== '')
    .map((block) => {
      const content: PmNode[] = [];
      block.split('\n').forEach((raw, i) => {
        const line = raw.replace(/[ \t]+/g, ' ').trim();
        if (i > 0) content.push(schema.nodes.hardBreak.create());
        if (line) content.push(schema.text(line));
      });
      return schema.nodes.paragraph.create(null, content);
    });
  // Open on both sides so a one-line paste joins the paragraph at the caret.
  return new Slice(Fragment.from(paragraphs), 1, 1);
}

/**
 * The eraser: inline formatting (bold, italic, underline, strike, inline code) and
 * alignment go; the block (heading, list, table…) stays, and so do links — like
 * clearing formatting in Word or Google Docs. Mark by mark rather than
 * unsetAllMarks, which would drop links too; unsetMark also clears the marks
 * waiting at a bare caret, so what is typed next comes out plain.
 */
const clearFormatting = (editor: Editor) => {
  // Alignment first: a document step after the marks would reset the cleared caret marks.
  const chain = editor.chain().focus().unsetTextAlign();
  Object.keys(editor.schema.marks)
    .filter((name) => name !== 'link')
    .forEach((name) => chain.unsetMark(name));
  return chain.run();
};

/** Ctrl/Cmd+Shift+M clears formatting (matched by key position, so any layout works). */
const ClearFormattingKey = Extension.create({
  name: 'clearFormattingKey',
  addKeyboardShortcuts() {
    return { 'Mod-Shift-m': () => clearFormatting(this.editor) };
  },
});

/** Grey hint text while the editor is empty, focused or not. */
const Placeholder = Extension.create<{ text: () => string }>({
  name: 'placeholder',
  addOptions() {
    return { text: () => '' };
  },
  addProseMirrorPlugins() {
    // Read on every redraw, so a change of interface language shows up.
    const text = this.options.text;
    return [
      new Plugin({
        key: new PluginKey('placeholder'),
        props: {
          decorations: ({ doc }) => {
            const first = doc.firstChild;
            if (doc.childCount !== 1 || !first?.isTextblock || first.content.size > 0) return null;
            return DecorationSet.create(doc, [
              Decoration.node(0, first.nodeSize, { class: 'is-empty', 'data-placeholder': text() }),
            ]);
          },
        },
      }),
    ];
  },
});

/** The page background of `doc`, or null when it has none. */
function pageOf(doc: PmNode): PageColors | null {
  const page = colorsOf(doc.attrs);
  return page.backgroundColor || page.color ? page : null;
}

/**
 * The editor's HTML as the form gets it: in browser terms, inside its page
 * background. With no text but a page background, still the page around an empty
 * line, so the colour survives a switch of language or view while editing; saving
 * stores nothing for it (normalizeHtml: no text, no value).
 */
export const editorHtml = (e: Editor) => {
  const page = pageOf(e.state.doc);
  return e.isEmpty && !page ? '' : joinPage(fromEditorHtml(e.getHTML()), page);
};

/**
 * After a paste or a drop, what came in is checked against what it now sits on (the
 * page, a cell, a box), as the toolbar's colour changes are: its colours were chosen
 * for another background, and saving would drop those that do not show. Part of
 * the paste's own undo step (an appended transaction).
 */
const KeepPastedReadable = Extension.create({
  name: 'keepPastedReadable',
  // Ahead of the table plugin, so its handlePaste (which only notes the paste) runs first.
  priority: 1000,
  addProseMirrorPlugins() {
    // True while a paste event is being handled. The table plugin pastes cells into a
    // table with its own transaction, which carries no uiEvent mark; it runs in the
    // same event, right after this plugin's handlePaste.
    let pasting = false;
    return [
      new Plugin({
        key: new PluginKey('keepPastedReadable'),
        props: {
          handlePaste: () => {
            pasting = true;
            queueMicrotask(() => {
              pasting = false;
            });
            return false;
          },
        },
        appendTransaction: (transactions, _old, state) => {
          // Where the pasted content is in the final document.
          let ranges: { from: number; to: number }[] = [];
          transactions.forEach((t) => {
            ranges = ranges.map((r) => ({
              from: t.mapping.map(r.from, -1),
              to: t.mapping.map(r.to, 1),
            }));
            if (!pasting && !['paste', 'drop'].includes(t.getMeta('uiEvent'))) return;
            t.mapping.maps.forEach((map, i) => {
              const rest = t.mapping.slice(i + 1);
              map.forEach((_from, _to, from, to) =>
                ranges.push({ from: rest.map(from, -1), to: rest.map(to, 1) }),
              );
            });
          });
          if (!ranges.length) return null;
          const tr = state.tr;
          const size = tr.doc.content.size;
          ranges.forEach(({ from, to }) => keepReadable(tr, Math.max(0, from), Math.min(size, to)));
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});

/**
 * Whether the selection holds all of the text: nothing but whitespace outside it.
 * Leaves (a rule, a line break) count as content, so they are not left behind.
 * Over all its ranges: a selection of table cells has one per cell.
 */
function selectsAll({ doc, selection }: EditorState): boolean {
  const from = Math.min(...selection.ranges.map((r) => r.$from.pos));
  const to = Math.max(...selection.ranges.map((r) => r.$to.pos));
  const before = doc.textBetween(0, from, '\n', '￼');
  const after = doc.textBetween(to, doc.content.size, '\n', '￼');
  return !`${before}${after}`.trim();
}

/** A document that is only the empty paragraph the editor starts with. */
const isBlankDoc = (doc: PmNode) =>
  doc.childCount === 1 &&
  Boolean(doc.firstChild?.isTextblock) &&
  doc.firstChild!.content.size === 0;

/**
 * Copy or cut of all the text takes the page background along (as the outer <div>),
 * so pasting it into another language's editor brings the colour too. A part of the
 * text copies as usual, without it.
 */
function copyWithPage(view: EditorView, event: ClipboardEvent, cut: boolean): boolean {
  const { state } = view;
  const page = pageOf(state.doc);
  const data = event.clipboardData;
  if (!page || !data || state.selection.empty || !selectsAll(state)) return false;
  const { dom, text } = view.serializeForClipboard(state.selection.content());
  event.preventDefault();
  data.clearData();
  data.setData('text/html', joinPage(dom.innerHTML, page));
  data.setData('text/plain', text);
  if (cut) view.dispatch(state.tr.deleteSelection().scrollIntoView().setMeta('uiEvent', 'cut'));
  return true;
}

/**
 * What the letters' own colour must become when `pair` (letters, background) would
 * not show — say a dark highlight under dark text, or white text left behind once
 * its dark background is removed. `null`: drop it, what they inherit shows; else
 * black or white, whichever reads. `undefined` when they show already. `under` is
 * what is behind (the cell).
 */
function readableText(
  pair: ColorPair,
  under: ColorPair = { color: null, backgroundColor: null },
): string | null | undefined {
  const background = pair.backgroundColor ?? under.backgroundColor;
  if (readableOn(pair.color ?? under.color, background)) return undefined;
  return readableOn(under.color, background) ? null : textColorFor(background);
}

/** Colours from node or mark attributes; '' is none too (Tiptap reads a missing one so). */
const colorsOf = (attrs: Record<string, unknown>): ColorPair => ({
  color: (attrs.color as string | null | undefined) || null,
  backgroundColor: (attrs.backgroundColor as string | null | undefined) || null,
});

/** Nodes that colour what is inside them: table cells and the coloured box. */
const isContainer = (node: PmNode) =>
  node.type.name === BOX ||
  node.type.spec.tableRole === 'cell' ||
  node.type.spec.tableRole === 'header_cell';

/**
 * What text at document position `pos` sits on: the nearest text colour and the
 * nearest background of the cells and boxes around it, inner first, as CSS
 * inherits them, and last the page background; all null on a plain white page.
 * At a cell's or box's own position, what is around that cell or box.
 */
function colorsAround(doc: PmNode, pos: number): ColorPair {
  const $pos = doc.resolve(pos);
  const around: ColorPair = { color: null, backgroundColor: null };
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (!isContainer(node)) continue;
    const own = colorsOf(node.attrs);
    around.color ??= own.color;
    around.backgroundColor ??= own.backgroundColor;
  }
  const page = colorsOf(doc.attrs);
  around.color ??= page.color;
  around.backgroundColor ??= page.backgroundColor;
  return around;
}

/**
 * Sets the page background's colours (null removes one). Its own text colour turns
 * black or white, or goes, when it would not show on the new background; then
 * everything inside is checked against it (keepReadable). One transaction: one undo.
 */
function setPage(tr: Transaction, colors: Partial<PageColors>) {
  Object.entries(colors).forEach(([name, value]) => tr.setDocAttribute(name, value ?? null));
  const fix = readableText(colorsOf(tr.doc.attrs));
  if (fix !== undefined) tr.setDocAttribute('color', fix);
  keepReadable(tr, 0, tr.doc.content.size);
}

/**
 * Everything between `from` and `to` that would no longer show on what is behind
 * it — a cell's or a box's own text, coloured words — loses its own colour, or
 * turns black or white. Outer first, so what is inside is judged against the
 * outer colours as they now are; word by word, so differently coloured words each
 * get what they need. In the colour change's own transaction: one undo step.
 * Saving would drop such colours anyway; this way the admin sees it happen.
 */
function keepReadable(tr: Transaction, from: number, to: number) {
  const type = tr.doc.type.schema.marks.textStyle;
  if (from >= to) return;
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (isContainer(node)) {
      const fix = readableText(colorsOf(node.attrs), colorsAround(tr.doc, pos));
      if (fix !== undefined) tr.setNodeMarkup(pos, undefined, { ...node.attrs, color: fix });
      return true;
    }
    if (!node.isText) return true;
    const mark = type && node.marks.find((m) => m.type === type);
    if (!mark) return false;
    const fix = readableText(colorsOf(mark.attrs), colorsAround(tr.doc, pos));
    if (fix === undefined) return false;
    const start = Math.max(pos, from);
    const end = Math.min(pos + node.nodeSize, to);
    const attrs = { ...mark.attrs, color: fix };
    if (Object.values(attrs).some(Boolean)) tr.addMark(start, end, type.create(attrs));
    else tr.removeMark(start, end, type);
    return false;
  });
}

/**
 * After a cell colour change: each selected cell on its own (a selection can span
 * cells of different colours), with everything inside it.
 */
function keepCellsReadable(tr: Transaction) {
  const { selection } = tr;
  const cells: number[] = [];
  if (selection instanceof CellSelection) selection.forEachCell((_cell, pos) => cells.push(pos));
  else {
    const $cell = cellAround(selection.$head);
    if ($cell) cells.push($cell.pos);
  }
  cells.forEach((pos) => keepReadable(tr, pos, pos + (tr.doc.nodeAt(pos)?.nodeSize ?? 0)));
}

/** The box around the selection: its colours, and what is around it. */
function boxState(e: Editor): Pick<ToolbarState, 'box' | 'boxUnder'> {
  const { doc, selection } = e.state;
  const pos = boxAround(selection.$from);
  const box = pos === null ? null : doc.nodeAt(pos);
  return {
    box: box && {
      backgroundColor: box.attrs.backgroundColor || null,
      color: box.attrs.color || null,
      borderColor: box.attrs.borderColor || null,
    },
    boxUnder: colorsAround(doc, pos ?? selection.from),
  };
}

const ALIGNS: Align[] = ['center', 'right', 'justify'];
const MODIFIER_KEYS = ['Shift', 'Control', 'Alt', 'Meta'];

/** The selection's own text colours (the coloured-text mark). */
function textColors(e: Editor): ColorPair {
  return colorsOf(e.getAttributes('textStyle'));
}

let popupSeq = 0;
const nextPopupId = () => (popupSeq += 1);

/** A popup over the text: the link bubble or the table cell bubble. */
type TextPopup =
  // `id` keys the bubble: a new link (even one with the same address) gets a fresh one.
  | { kind: 'link'; anchor: HTMLAnchorElement; focus: boolean; id: number }
  // `id` changes when the keyboard opens it, so each Alt+F10 focuses it afresh.
  | { kind: 'cell'; focus: boolean; id: number }
  | null;

/**
 * Tiptap (ProseMirror) WYSIWYG behind its own toolbar. Only what its schema knows
 * survives: tags outside StarterKit + TextAlign + ListStyle + coloured text + the
 * coloured box + tables (and the page background, kept as document attributes) are
 * dropped when HTML is loaded or pasted into it.
 */
export default function TiptapEditor({
  value,
  onChange,
  onLoad,
  lang,
  label,
}: RichEditorProps & {
  /** The HTML once `value` has been parsed through the schema — fires on mount. */
  onLoad?: (html: string) => void;
  /** The language being edited: sets `lang` and whether the browser spell-checks. */
  lang?: Lang;
  /** Accessible name of the text area, e.g. "General conditions — English". */
  label?: string;
}) {
  const { t } = useT(messages);
  // The parent hands new callbacks on every render; read them through refs.
  const onChangeRef = useRef(onChange);
  const onLoadRef = useRef(onLoad);
  // Set by the toolbar: Ctrl/Cmd+K opens its link popup.
  const shortcutsRef = useRef<ToolbarShortcuts | null>(null);
  // Set each render below: the editor's own key handling (popups, Alt+F10, Ctrl+K).
  const keyHandlerRef = useRef<((event: KeyboardEvent) => boolean) | null>(null);
  useEffect(() => {
    onChangeRef.current = onChange;
    onLoadRef.current = onLoad;
  });
  // Texts in the interface language, which can change while the editor is open
  // (topbar switch). The options below are built once, so they read these refs.
  const placeholderText = t('placeholder');
  const ariaLabel = label ?? t('editor');
  const textsRef = useRef({ placeholder: placeholderText, label: ariaLabel });

  // Built once per mount. Tiptap compares these options on every render and
  // re-applies them when anything differs, so fresh extension instances or a fresh
  // editorProps object here would re-run the whole editor setup on each keystroke.
  // The field remounts this component (by key) to load another language.
  // The page background of the HTML being pasted (the editor's own copy of all the
  // text), from transformPastedHTML to handlePaste, which decides whether it applies.
  const pastedPageRef = useRef<PageColors | null>(null);

  const [options] = useState<UseEditorOptions>(() => {
    // The page background is the document's attributes, not content: taken off here
    // and set on the document before the editor shows it (onBeforeCreate).
    const { page, body } = splitPage(sanitizeHtml(value));
    return {
      extensions: [
        ...schemaExtensions(),
        ClearFormattingKey,
        KeepPastedReadable,
        Placeholder.configure({ text: () => textsRef.current.placeholder }),
      ],
      // Line breaks into the editor's terms (toEditorHtml), and table defaults added on
      // save come off again, or they would turn into cell attributes.
      content: toEditorHtml(stripTableDefaults(body)),
      onBeforeCreate: ({ editor: e }) => {
        if (!page) return;
        const doc = createDocument(e.options.content as string, e.schema);
        e.options.content = e.schema.topNodeType.create(page, doc.content).toJSON();
      },
      // Loaded lazily in the browser (React.lazy, no server rendering), so the first render is already there.
      immediatelyRender: true,
      // Handed on in browser terms (fromEditorHtml): the lines shown here are the lines
      // shown in the read view and the app.
      onCreate: ({ editor: e }) => onLoadRef.current?.(editorHtml(e)),
      onUpdate: ({ editor: e }) => onChangeRef.current(editorHtml(e)),
      editorProps: {
        // A function, so ProseMirror re-reads the name after an interface-language change,
        // and the page background after each change of it.
        attributes: (state) => ({
          class: 'rich-text-content rich-text-editable',
          ...(pageOf(state.doc) && { style: pageStyle(pageOf(state.doc)) }),
          // A named multi-line text box for screen readers (a bare contenteditable has no name).
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': textsRef.current.label,
          ...(lang && { lang }),
          // Browsers ship no Uzbek or Karakalpak dictionary, so every word there would be
          // underlined in red; Russian and English keep the check.
          spellcheck: lang === 'ru' || lang === 'en' ? 'true' : 'false',
        }),
        handleKeyDown: (_view, event) => keyHandlerRef.current?.(event) ?? false,
        handleDOMEvents: {
          copy: (view, event) => copyWithPage(view, event, false),
          cut: (view, event) => copyWithPage(view, event, true),
        },
        // Pasted HTML keeps its own CSS so the schema can read bold/italic from it (Google
        // Docs); only freezing spans are capped. Saving cleans it like any other HTML.
        // Line breaks come into the editor's terms — unless the HTML is the editor's own
        // copy (ProseMirror marks it data-pm-slice), which already is in them.
        // The editor's own copy of all the text may come in its page background (see
        // copyWithPage): that is taken off here, handlePaste decides what it does.
        transformPastedHTML: (html) => {
          const own = html.includes('data-pm-slice');
          const { page: pasted, body: content } = own
            ? splitPage(html)
            : { page: null, body: html };
          pastedPageRef.current = pasted;
          const prepared = stripTableDefaults(preparePastedHtml(content));
          return own ? prepared : toEditorHtml(prepared);
        },
        // A pasted page background replaces this one only when the paste replaces all
        // the text (or there is none yet); a paste into the text keeps this page's own.
        handlePaste: (view, _event, slice) => {
          const pasted = pastedPageRef.current;
          pastedPageRef.current = null;
          const { state } = view;
          const all = state.selection.empty ? isBlankDoc(state.doc) : selectsAll(state);
          if (!pasted || !all) return false;
          const tr = state.tr.replaceSelection(slice);
          setPage(tr, pasted);
          view.dispatch(tr.scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'));
          return true;
        },
        // A drop parses through transformPastedHTML too, but never reaches handlePaste.
        handleDrop: () => {
          pastedPageRef.current = null;
          return false;
        },
        clipboardTextParser: plainTextToSlice,
      },
    };
  });
  const editor = useEditor(options, []);

  // Interface language switched: hand the new texts over and redraw — an empty
  // transaction (no document change, nothing to undo) makes ProseMirror re-read the
  // attributes and the placeholder decoration.
  useEffect(() => {
    const texts = textsRef.current;
    if (texts.placeholder === placeholderText && texts.label === ariaLabel) return;
    textsRef.current = { placeholder: placeholderText, label: ariaLabel };
    if (editor && !editor.isDestroyed) {
      editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false));
    }
  }, [editor, placeholderText, ariaLabel]);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }): ToolbarState | null => {
      if (!e) return null;
      const heading = HEADINGS.find((level) => e.isActive('heading', { level }));
      const block: BlockType = e.isActive('codeBlock')
        ? 'pre'
        : heading
          ? (`h${heading}` as BlockType)
          : e.isActive('blockquote')
            ? 'blockquote'
            : 'p';
      return {
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        strike: e.isActive('strike'),
        block,
        bullet: e.isActive('bulletList'),
        ordered: e.isActive('orderedList'),
        link: e.isActive('link'),
        align: ALIGNS.find((a) => e.isActive({ textAlign: a })) ?? 'left',
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
        colors: textColors(e),
        fontSize: e.getAttributes('textStyle').fontSize ?? null,
        under: colorsAround(e.state.doc, e.state.selection.from),
        ...boxState(e),
        page: colorsOf(e.state.doc.attrs),
      };
    },
  });

  // The cell under the selection, for the cell popup; null outside a table.
  const table = useEditorState({
    editor,
    selector: ({ editor: e }): (TableState & { cellPos: number }) | null => {
      const cellPos = e ? currentCellPos(e) : null;
      if (!e || cellPos === null) return null;
      const attrs = e.state.doc.nodeAt(cellPos)?.attrs ?? {};
      return {
        cellPos,
        canMerge: e.can().mergeCells(),
        headerRow: firstRowIsHeader(e),
        valign: attrs.verticalAlign ?? null,
        align: attrs.align ?? null,
        colors: {
          backgroundColor: attrs.backgroundColor || null,
          color: attrs.color || null,
          borderColor: attrs.borderColor || null,
        },
        under: colorsAround(e.state.doc, cellPos),
      };
    },
  });

  // Popups over the text open on a click (or Alt+F10) and close on typing, on a
  // press elsewhere, on Esc, or when the caret leaves what they are about.
  const [popup, setPopup] = useState<TextPopup>(null);
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => setPopup((p) => (p?.kind === 'link' ? null : p));
    const onSelection = () =>
      setPopup((p) => {
        if (p?.kind === 'link' && !editor.isActive('link')) return null;
        if (p?.kind === 'cell' && currentCellPos(editor) === null) return null;
        return p;
      });
    editor.on('update', onUpdate);
    editor.on('selectionUpdate', onSelection);
    return () => {
      editor.off('update', onUpdate);
      editor.off('selectionUpdate', onSelection);
    };
  }, [editor]);

  useEffect(() => {
    keyHandlerRef.current = (event) => {
      if (!editor) return false;
      // Alt+F10: the popup for what the caret is in, or else the toolbar — the way
      // to all of them without a mouse.
      if (event.altKey && event.key === 'F10') {
        event.preventDefault();
        const at = editor.view.domAtPos(editor.state.selection.from).node;
        const anchor = (at instanceof Element ? at : at.parentElement)?.closest('a');
        if (editor.isActive('link') && anchor)
          setPopup({ kind: 'link', anchor, focus: true, id: nextPopupId() });
        else if (currentCellPos(editor) !== null)
          setPopup({ kind: 'cell', focus: true, id: nextPopupId() });
        else
          editor.view.dom
            .closest('.rich-editor')
            ?.querySelector<HTMLElement>('.rich-editor__toolbar button:not(:disabled)')
            ?.focus();
        return true;
      }
      // Any other key (not a lone modifier) hides the popups, as typing would move them.
      if (!MODIFIER_KEYS.includes(event.key)) setPopup(null);
      // By key position, so Ctrl+K works on a Russian layout too.
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.code === 'KeyK'
      ) {
        event.preventDefault();
        shortcutsRef.current?.link();
        return true;
      }
      return false;
    };
  });

  if (!editor || !state) return <EditorShell toolbar={null}>{null}</EditorShell>;
  const chain = () => editor.chain().focus();
  const selectedText = () => {
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to, ' ');
  };
  const closeAndFocus = () => {
    setPopup(null);
    editor.commands.focus();
  };

  const actions: ToolbarActions = {
    bold: () => chain().toggleBold().run(),
    italic: () => chain().toggleItalic().run(),
    underline: () => chain().toggleUnderline().run(),
    strike: () => chain().toggleStrike().run(),
    block: (to) => {
      const c = chain();
      if (to !== 'blockquote' && editor.isActive('blockquote')) c.unsetBlockquote();
      if (to === 'p') c.setParagraph();
      else if (to === 'pre') c.setCodeBlock();
      else if (to === 'blockquote') c.setParagraph().setBlockquote();
      else c.setHeading({ level: Number(to[1]) as (typeof HEADINGS)[number] });
      c.run();
    },
    list: (kind, style) => {
      const name = kind === 'bullet' ? 'bulletList' : 'orderedList';
      const toggleList = () =>
        kind === 'bullet' ? chain().toggleBulletList() : chain().toggleOrderedList();
      if (!editor.isActive(name)) {
        toggleList().updateAttributes(name, { listStyleType: style }).run();
      } else if ((editor.getAttributes(name).listStyleType ?? null) === style) {
        toggleList().run();
      } else {
        chain().updateAttributes(name, { listStyleType: style }).run();
      }
    },
    align: (to) => chain().setTextAlign(to).run(),
    textColor: (kind, color) => {
      const next = { ...textColors(editor), [kind]: color };
      const c = chain();
      if (kind === 'backgroundColor') {
        if (color) c.setBackgroundColor(color);
        else c.unsetBackgroundColor();
      } else if (color) c.setColor(color);
      else c.unsetColor();
      // Letters that would vanish on their highlight lose their own colour, or turn
      // black or white with it: run by run over a selection, which may hold
      // differently coloured words; at a bare caret, for what is typed next.
      if (editor.state.selection.empty) {
        const fix = readableText(next, colorsAround(editor.state.doc, editor.state.selection.from));
        if (fix) c.setColor(fix);
        else if (fix === null) c.unsetColor();
      } else {
        c.command(({ tr }) => {
          tr.selection.ranges.forEach((r) => keepReadable(tr, r.$from.pos, r.$to.pos));
          return true;
        });
      }
      c.run();
    },
    boxColor: (kind, color) =>
      chain()
        .command(({ tr }) => {
          let pos = boxAround(tr.selection.$from);
          if (pos === null) {
            // "No colour" outside a box: nothing to do.
            if (!color) return true;
            pos = wrapInBox(tr, { borderColor: BOX_BORDER, [kind]: color });
            if (pos === null) return false;
          } else {
            const node = tr.doc.nodeAt(pos)!;
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, [kind]: color });
          }
          const box = tr.doc.nodeAt(pos)!;
          // A box with neither background nor border shows nothing: it goes.
          if (!box.attrs.backgroundColor && !box.attrs.borderColor) unwrapBox(tr, pos);
          else keepReadable(tr, pos, pos + box.nodeSize);
          return true;
        })
        .run(),
    removeBox: () =>
      chain()
        .command(({ tr }) => {
          const pos = boxAround(tr.selection.$from);
          if (pos !== null) unwrapBox(tr, pos);
          return pos !== null;
        })
        .run(),
    pageColor: (kind, color) =>
      chain()
        .command(({ tr }) => {
          setPage(tr, { [kind]: color });
          return true;
        })
        .run(),
    // removeEmptyTextStyle: a run left with no size and no colour loses its <span>.
    fontSize: (size) =>
      (size
        ? chain().setMark('textStyle', { fontSize: size })
        : chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle()
      ).run(),
    clearFormatting: () => clearFormatting(editor),
    undo: () => chain().undo().run(),
    redo: () => chain().redo().run(),
    insertText: (text) => chain().insertContent(text).run(),
    insertTable: (rows, cols) => chain().insertTable({ rows, cols, withHeaderRow: false }).run(),
    focusEditor: () => editor.commands.focus(),
  };

  const tableActions: TableActions = {
    setColor: (kind, color) => {
      const c = chain().setCellAttribute(kind, color);
      // Text that would vanish on a cell's new background (or in its new colour)
      // loses its colour, or turns black or white with it — in every selected cell,
      // coloured words inside included. A border changes nothing of that.
      if (kind !== 'borderColor') {
        c.command(({ tr }) => {
          keepCellsReadable(tr);
          return true;
        });
      }
      c.run();
    },
    setVAlign: (to) => chain().setCellAttribute('verticalAlign', to).run(),
    setAlign: (to) => chain().setCellAttribute('align', to).run(),
    split: (direction) => splitCell(editor, direction),
    merge: () => chain().mergeCells().run(),
    addColumn: (side) =>
      (side === 'before' ? chain().addColumnBefore() : chain().addColumnAfter()).run(),
    addRow: (side) => (side === 'before' ? chain().addRowBefore() : chain().addRowAfter()).run(),
    deleteTable: () => chain().deleteTable().run(),
    deleteRow: () => chain().deleteRow().run(),
    deleteColumn: () => chain().deleteColumn().run(),
    emptyCells: () => emptyCells(editor),
    toggleHeaderRow: () => chain().toggleHeaderRow().run(),
  };
  // Read when the popup renders, not here: after a column is deleted the cell at the
  // same position is a new element, and this component may not re-render for it.
  const cellAnchor = () => {
    const pos = currentCellPos(editor);
    return pos === null ? null : (editor.view.nodeDOM(pos) as HTMLElement | null);
  };

  const link: LinkAdapter = {
    read: () => {
      const isLink = editor.isActive('link');
      // Select the whole link, so its text can be edited.
      if (isLink) editor.commands.extendMarkRange('link');
      const attrs = editor.getAttributes('link');
      return {
        href: (attrs.href as string | undefined) ?? '',
        text: selectedText(),
        newTab: attrs.target === '_blank',
        isLink,
      };
    },
    apply: ({ href, text, newTab }) => {
      // Editing a link keeps the rel words it already had (nofollow, ugc… from an older
      // text; the form has no option for them, the app ignores them); the new-tab
      // checkbox only adds or removes noopener noreferrer.
      const kept = editor.isActive('link')
        ? String(editor.getAttributes('link').rel ?? '')
            .split(/\s+/)
            .filter((w) => w && w !== 'noopener' && w !== 'noreferrer')
        : [];
      const attrs = {
        href,
        target: newTab ? '_blank' : null,
        rel: [...(newTab ? ['noopener', 'noreferrer'] : []), ...kept].join(' ') || null,
      };
      // A bare caret inside a link (the selection collapsed while the form was open)
      // means that link: take all of it, or the address would be inserted mid-link.
      if (editor.state.selection.empty && editor.isActive('link')) {
        editor.commands.extendMarkRange('link');
      }
      const current = selectedText();
      // New text only when the admin typed one, or when there is nothing to link yet.
      const label = text?.trim() || (current ? null : href);
      if (label && label !== current) {
        chain()
          .insertContent({ type: 'text', text: label, marks: [{ type: 'link', attrs }] })
          .run();
      } else {
        chain().setLink(attrs).run();
      }
    },
    unlink: () => chain().extendMarkRange('link').unsetLink().run(),
    restore: () => editor.commands.focus(),
  };

  return (
    <EditorShell
      toolbar={
        <RichToolbar state={state} actions={actions} link={link} shortcutsRef={shortcutsRef} />
      }
      overlay={
        <>
          {popup?.kind === 'link' && (
            <LinkBubble
              key={popup.id}
              anchor={popup.anchor}
              link={link}
              autoFocus={popup.focus}
              onClose={() => setPopup(null)}
            />
          )}
          {popup?.kind === 'cell' && table && (
            <TableBubble
              key={popup.id}
              anchor={cellAnchor}
              state={table}
              actions={tableActions}
              autoFocus={popup.focus}
              onClose={() => setPopup(null)}
              onEscape={closeAndFocus}
            />
          )}
        </>
      }
    >
      <EditorContent
        editor={editor}
        className="rich-text-frame"
        onMouseUp={(e) => {
          const a = (e.target as Element).closest('a');
          if (a && editor.view.dom.contains(a)) {
            // A press inside the link already open keeps its bubble (and an open edit
            // form) as it is; another link opens its own.
            setPopup((p) =>
              p?.kind === 'link' && p.anchor === a
                ? p
                : { kind: 'link', anchor: a, focus: false, id: nextPopupId() },
            );
            return;
          }
          // After ProseMirror has settled the selection (a drag may end in a CellSelection).
          setTimeout(() => {
            if (editor.isDestroyed) return;
            // A click keeps an open cell popup as it is (and its open dropdown).
            setPopup((p) =>
              currentCellPos(editor) === null
                ? null
                : p?.kind === 'cell'
                  ? { ...p, focus: false }
                  : { kind: 'cell', focus: false, id: nextPopupId() },
            );
          }, 0);
        }}
      />
    </EditorShell>
  );
}
