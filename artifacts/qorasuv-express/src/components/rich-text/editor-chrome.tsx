import { useEffect, useId, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { useT } from '@/i18n';
import messages from '@/i18n/messages/richText';
import { FONT_SIZES, LINK_PROTOCOL, readableOn, type FontSize } from '../../lib/rich-html';
import { ColorPicker } from './color-picker';
import { icons } from './toolbar-icons';
import { TablePicker } from './table-chrome';
import {
  Bubble,
  Menu,
  moveFocus,
  PopupSlot,
  Separator,
  SplitButton,
  ToolButton,
  type TextAlign,
} from './chrome-primitives';

/**
 * Editor chrome in the Jodit look and behaviour — toolbar, dropdowns, link popup,
 * frame. Tiptap is headless, so all of this is ours; the classes are styled in
 * global.css (`.rich-editor*`).
 */

export type { TextAlign };
/** The "paragraph" list: p, h1–h4, quote, code. */
export type BlockType = 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'blockquote' | 'pre';
type ListKind = 'bullet' | 'ordered';
/** CSS list-style-type; null = the browser default. */
export type ListStyle = string | null;
/** What the text colour popup sets: the letters, or the highlight behind them. */
type TextColorKind = 'color' | 'backgroundColor';
/** A text and a background colour; null is none of its own. */
export type ColorPair = Record<TextColorKind, string | null>;
/** What the coloured box popup sets. */
type BoxColorKind = 'backgroundColor' | 'color' | 'borderColor';
type BoxColors = Record<BoxColorKind, string | null>;

/** What the toolbar shows for the current selection. */
export interface ToolbarState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  block: BlockType;
  bullet: boolean;
  ordered: boolean;
  link: boolean;
  align: TextAlign;
  canUndo: boolean;
  canRedo: boolean;
  /** The selected text's own colours. */
  colors: ColorPair;
  /** The selected text's size, one of FONT_SIZES; null is the size around it. */
  fontSize: string | null;
  /** The colours the selection sits in: of the cells and boxes around it. */
  under: ColorPair;
  /** The coloured box around the selection, or null. */
  box: BoxColors | null;
  /** What is around that box (around the selection when there is none). */
  boxUnder: ColorPair;
  /** The page background: behind all the text, and its text colour. */
  page: ColorPair;
}

/** One command per toolbar control; the engine maps them onto its own API. */
export interface ToolbarActions {
  bold: () => void;
  italic: () => void;
  underline: () => void;
  strike: () => void;
  block: (to: BlockType) => void;
  /**
   * Outside a list, make one with `style`; in a list of the same kind and
   * style, remove it; in one with another style, restyle it.
   */
  list: (kind: ListKind, style: ListStyle) => void;
  align: (to: TextAlign) => void;
  /** Sizes the selected text (null: back to the size around it). */
  fontSize: (size: FontSize | null) => void;
  /** Colours the selected text (null removes its own colour of that kind). */
  textColor: (kind: TextColorKind, color: string | null) => void;
  /**
   * Colours the box around the selection, or puts the selected blocks in a new one.
   * null removes that colour; a box left with neither background nor border goes.
   */
  boxColor: (kind: BoxColorKind, color: string | null) => void;
  /** Takes the box around the selection away, keeping what is in it. */
  removeBox: () => void;
  /** Colours the page background, behind all the text (null removes that colour). */
  pageColor: (kind: TextColorKind, color: string | null) => void;
  clearFormatting: () => void;
  undo: () => void;
  redo: () => void;
  /** Types `text` at the caret (the symbols popup). */
  insertText: (text: string) => void;
  /** The table inserter: a rows × cols table at the caret. */
  insertTable: (rows: number, cols: number) => void;
  /** Focus back to the text, with its selection. */
  focusEditor: () => void;
}

interface LinkValue {
  href: string;
  text: string;
  newTab: boolean;
}

interface LinkInitial extends LinkValue {
  isLink: boolean;
}

/** The link popup's view of the editor. */
export interface LinkAdapter {
  /** The link under the caret (or the selected text) when the popup opens. */
  read: () => LinkInitial;
  /**
   * A validated address. `text` is set only when the admin edited it; then it
   * replaces the link text, otherwise the text (and its formatting) stays.
   */
  apply: (value: Omit<LinkValue, 'text'> & { text?: string }) => void;
  unlink: () => void;
  /** Focus back to the editor when the popup closes without a change. */
  restore: () => void;
}

type PopupName =
  | 'paragraph'
  | 'bullet'
  | 'ordered'
  | 'align'
  | 'link'
  | 'symbols'
  | 'table'
  | 'color'
  | 'size'
  | 'box'
  | 'page';

/** Popups the editor opens from its own hotkeys. */
export interface ToolbarShortcuts {
  link: () => void;
}

/**
 * A short, task-fit symbols dialog: what an admin writing roaming
 * conditions in uz/ru/en actually needs and cannot easily type. First the Uzbek
 * Latin apostrophes — ʻ (U+02BB) for oʻ/gʻ and ʼ (U+02BC) for the tutuq belgisi.
 * Names are keys of i18n/messages/richText.ts, so screen readers say what each glyph is.
 */
const SYMBOLS: { ch: string; key: keyof typeof messages.uz }[] = [
  { ch: 'ʻ', key: 'symOkina' },
  { ch: 'ʼ', key: 'symTutuq' },
  { ch: '«', key: 'symGuillemetLeft' },
  { ch: '»', key: 'symGuillemetRight' },
  { ch: '„', key: 'symQuoteLow' },
  { ch: '“', key: 'symQuoteHigh' },
  { ch: '—', key: 'symEmDash' },
  { ch: '–', key: 'symEnDash' },
  { ch: '№', key: 'symNumero' },
  { ch: '≈', key: 'symAlmostEqual' },
  { ch: '±', key: 'symPlusMinus' },
  { ch: '×', key: 'symTimes' },
  { ch: '°', key: 'symDegree' },
  { ch: '€', key: 'symEuro' },
  { ch: '$', key: 'symDollar' },
  { ch: '₽', key: 'symRuble' },
  { ch: '→', key: 'symArrowRight' },
  { ch: '•', key: 'symBullet' },
  { ch: '…', key: 'symEllipsis' },
  { ch: '©', key: 'symCopyright' },
];

const SYMBOL_COLUMNS = 5;

function SymbolGrid({ onPick }: { onPick: (ch: string) => void }) {
  const { t } = useT(messages);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.querySelector<HTMLElement>('button')?.focus(), []);
  return (
    <div className="rich-editor__symbols">
      <div
        ref={ref}
        role="menu"
        aria-label={t('symbols')}
        className="rich-editor__symbol-grid"
        onKeyDown={(e) => {
          if (moveFocus(e, ref.current, { next: ['ArrowRight'], prev: ['ArrowLeft'] })) return;
          // Up / down jump a row of the 5-wide grid.
          const step = { ArrowDown: SYMBOL_COLUMNS, ArrowUp: -SYMBOL_COLUMNS }[e.key];
          if (!step) return;
          const buttons = Array.from(ref.current?.querySelectorAll('button') ?? []);
          const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const target = buttons[i + step];
          if (!target) return;
          e.preventDefault();
          target.focus();
        }}
      >
        {SYMBOLS.map((s) => (
          <button
            key={s.ch}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="rich-editor__symbol"
            title={`${s.ch}  ${t(s.key)}`}
            aria-label={t(s.key)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(s.ch)}
          >
            {s.ch}
          </button>
        ))}
      </div>
      <p className="rich-editor__hint">{t('symbolsHint')}</p>
    </div>
  );
}

export function RichToolbar({
  state,
  actions,
  link,
  shortcutsRef,
}: {
  state: ToolbarState;
  actions: ToolbarActions;
  link: LinkAdapter;
  /** Filled with the popup openers, for the editor's Ctrl/Cmd+K. */
  shortcutsRef?: MutableRefObject<ToolbarShortcuts | null>;
}) {
  const { t } = useT(messages);
  const [popup, setPopup] = useState<PopupName | null>(null);
  // What the link popup opened with — read on open, not during render.
  const [linkInitial, setLinkInitial] = useState<LinkInitial | null>(null);
  // The list buttons reuse the style last picked from their arrow.
  const listMemo = useRef<Record<ListKind, ListStyle>>({ bullet: null, ordered: null });

  const close = () => setPopup(null);
  // Closing a popup by its own button: if focus was inside it (a menu takes focus
  // when it opens), it would fall to the page as the popup goes — give it back to
  // the text. With the keyboard, focus is on the button already and stays there.
  const dismiss = () => {
    const focusInPopup = document.activeElement?.closest('.rich-editor__popup');
    close();
    if (focusInPopup) actions.focusEditor();
  };
  const toggle = (name: PopupName) => (popup === name ? dismiss() : setPopup(name));
  const openLink = () => {
    setLinkInitial(link.read());
    setPopup('link');
  };
  useEffect(() => {
    if (shortcutsRef) shortcutsRef.current = { link: openLink };
  });

  const blocks: { value: BlockType; label: string }[] = [
    { value: 'p', label: t('paragraphNormal') },
    { value: 'h1', label: t('heading1') },
    { value: 'h2', label: t('heading2') },
    { value: 'h3', label: t('heading3') },
    { value: 'h4', label: t('heading4') },
    { value: 'blockquote', label: t('quote') },
    { value: 'pre', label: t('code') },
  ];
  // Smallest first; the menu draws each at its size, capped so the menu fits.
  const sizeLabels: Record<FontSize, string> = {
    '0.8em': t('sizeSmall'),
    '1.25em': t('sizeLarge'),
    '1.6em': t('sizeLarger'),
    '2.2em': t('sizeHuge'),
    '3em': t('sizeTitle'),
  };
  const sizes: { value: FontSize | null; label: string; preview: string }[] = [
    { value: '0.8em', label: sizeLabels['0.8em'], preview: '12px' },
    { value: null, label: t('sizeNormal'), preview: '14px' },
    ...FONT_SIZES.filter((size) => size !== '0.8em').map((size) => ({
      value: size,
      label: sizeLabels[size],
      preview: `${Math.min(14 * parseFloat(size), 38)}px`,
    })),
  ];
  // In this order: center, left, right, justify.
  const aligns: { value: TextAlign; label: string }[] = [
    { value: 'center', label: t('alignCenter') },
    { value: 'left', label: t('alignLeft') },
    { value: 'right', label: t('alignRight') },
    { value: 'justify', label: t('alignJustify') },
  ];
  const listStyles: Record<ListKind, { value: ListStyle; label: string }[]> = {
    bullet: [
      { value: null, label: t('listDefault') },
      { value: 'circle', label: t('listCircle') },
      { value: 'disc', label: t('listDot') },
      { value: 'square', label: t('listSquare') },
    ],
    ordered: [
      { value: null, label: t('listDefault') },
      { value: 'lower-alpha', label: t('listLowerAlpha') },
      { value: 'lower-greek', label: t('listLowerGreek') },
      { value: 'lower-roman', label: t('listLowerRoman') },
      { value: 'upper-alpha', label: t('listUpperAlpha') },
      { value: 'upper-roman', label: t('listUpperRoman') },
    ],
  };

  const listControl = (kind: ListKind) => (
    <PopupSlot
      open={popup === kind}
      placement="top"
      onClose={close}
      button={
        <SplitButton
          icon={kind === 'bullet' ? icons.ul : icons.ol}
          label={kind === 'bullet' ? t('bulletList') : t('orderedList')}
          menuLabel={t('listStyle')}
          active={kind === 'bullet' ? state.bullet : state.ordered}
          expanded={popup === kind}
          onClick={() => actions.list(kind, listMemo.current[kind])}
          onTrigger={() => toggle(kind)}
        />
      }
    >
      <Menu
        label={t('listStyle')}
        items={listStyles[kind]}
        onSelect={(style) => {
          listMemo.current[kind] = style;
          actions.list(kind, style);
          close();
        }}
      />
    </PopupSlot>
  );

  return (
    <>
      {/* History */}
      <ToolButton
        icon={icons.undo}
        label={t('undo')}
        disabled={!state.canUndo}
        onClick={actions.undo}
      />
      <ToolButton
        icon={icons.redo}
        label={t('redo')}
        disabled={!state.canRedo}
        onClick={actions.redo}
      />
      <Separator />
      {/* The kind of block being written */}
      <PopupSlot
        open={popup === 'paragraph'}
        placement="top"
        onClose={close}
        button={
          <ToolButton
            icon={icons.paragraph}
            label={t('paragraph')}
            active={state.block !== 'p'}
            trigger
            expanded={popup === 'paragraph'}
            onClick={() => toggle('paragraph')}
          />
        }
      >
        <Menu
          label={t('paragraph')}
          selected={state.block}
          items={blocks.map((b) => ({
            value: b.value,
            label: (
              <span className={`rich-editor__block rich-editor__block_${b.value}`}>{b.label}</span>
            ),
          }))}
          onSelect={(to) => {
            // Picking the current format again turns it back into a paragraph.
            actions.block(to === state.block ? 'p' : to);
            close();
          }}
        />
      </PopupSlot>
      <Separator />
      {/* Formatting of the selected text */}
      <ToolButton
        icon={icons.bold}
        label={t('bold')}
        active={state.bold}
        onClick={actions.bold}
      />
      <ToolButton
        icon={icons.italic}
        label={t('italic')}
        active={state.italic}
        onClick={actions.italic}
      />
      <ToolButton
        icon={icons.underline}
        label={t('underline')}
        active={state.underline}
        onClick={actions.underline}
      />
      <ToolButton
        icon={icons.strikethrough}
        label={t('strike')}
        active={state.strike}
        onClick={actions.strike}
      />
      {/* Sizes relative to the text around them: the card's text follows the
          width it is shown at, so one choice is big on a wide screen and small
          on a phone. Each item is drawn at its own size. */}
      <PopupSlot
        open={popup === 'size'}
        placement="top"
        onClose={close}
        button={
          <ToolButton
            icon={icons.fontSize}
            label={t('fontSize')}
            active={Boolean(state.fontSize)}
            trigger
            expanded={popup === 'size'}
            onClick={() => toggle('size')}
          />
        }
      >
        <Menu<FontSize | null>
          label={t('fontSize')}
          selected={(state.fontSize as FontSize | null) ?? null}
          items={sizes.map((size) => ({
            value: size.value,
            label: <span className="rich-editor__size" style={{ fontSize: size.preview }}>{size.label}</span>,
          }))}
          onSelect={(size) => {
            actions.fontSize(size);
            close();
          }}
        />
      </PopupSlot>
      <PopupSlot
        open={popup === 'color'}
        placement="top"
        dialogLabel={t('textColor')}
        onClose={close}
        button={
          <ToolButton
            icon={icons.brush}
            haspopup="dialog"
            label={t('textColor')}
            active={Boolean(state.colors.color || state.colors.backgroundColor)}
            expanded={popup === 'color'}
            onClick={() => toggle('color')}
          />
        }
      >
        <ColorPicker<TextColorKind>
          label={t('textColor')}
          tabs={[
            { value: 'color', label: t('colorText') },
            { value: 'backgroundColor', label: t('colorBackground') },
          ]}
          value={state.colors}
          // Letters that would not show on what is behind them (their own highlight,
          // else the cell). A highlight is always offered: the editor turns the
          // letters black or white to go with it.
          unreadable={(kind, color) =>
            kind === 'color' &&
            !readableOn(color, state.colors.backgroundColor ?? state.under.backgroundColor)
          }
          onPick={(kind, color) => {
            actions.textColor(kind, color);
            close();
          }}
        />
      </PopupSlot>
      <PopupSlot
        open={popup === 'link'}
        dialogLabel={t('link')}
        onClose={(reason) => {
          close();
          // Back to the text only on Esc: after a press elsewhere (another field) or a
          // Tab away, focus is already where the admin wanted it.
          if (reason === 'escape') link.restore();
        }}
        button={
          <ToolButton
            icon={icons.link}
            haspopup="dialog"
            label={t('link')}
            active={state.link}
            expanded={popup === 'link'}
            onClick={() => (popup === 'link' ? dismiss() : openLink())}
          />
        }
      >
        {linkInitial && <LinkForm link={link} initial={linkInitial} onDone={close} />}
      </PopupSlot>
      <ToolButton
        icon={icons.eraser}
        label={t('clearFormatting')}
        onClick={actions.clearFormatting}
      />
      <Separator />
      {/* Paragraph: alignment and lists */}
      <PopupSlot
        open={popup === 'align'}
        placement="top"
        onClose={close}
        button={
          <ToolButton
            // The button shows the current alignment.
            icon={icons[state.align]}
            label={t('align')}
            active={state.align !== 'left'}
            trigger
            expanded={popup === 'align'}
            onClick={() => toggle('align')}
          />
        }
      >
        <Menu
          label={t('align')}
          selected={state.align}
          items={aligns.map((a) => ({
            value: a.value,
            label: (
              <>
                <span className="rich-editor__icon">{icons[a.value]}</span>
                {a.label}
              </>
            ),
          }))}
          onSelect={(to) => {
            actions.align(to);
            close();
          }}
        />
      </PopupSlot>
      {listControl('bullet')}
      {listControl('ordered')}
      <Separator />
      {/* Insert */}
      <PopupSlot
        open={popup === 'table'}
        onClose={close}
        button={
          <ToolButton
            icon={icons.table}
            haspopup="grid"
            label={t('table')}
            expanded={popup === 'table'}
            onClick={() => toggle('table')}
          />
        }
      >
        <TablePicker
          onPick={(rows, cols) => {
            actions.insertTable(rows, cols);
            close();
          }}
        />
      </PopupSlot>
      <PopupSlot
        open={popup === 'symbols'}
        onClose={close}
        button={
          <ToolButton
            icon={icons.symbols}
            label={t('symbols')}
            expanded={popup === 'symbols'}
            onClick={() => toggle('symbols')}
          />
        }
      >
        <SymbolGrid
          onPick={(ch) => {
            actions.insertText(ch);
            close();
          }}
        />
      </PopupSlot>
      <Separator />
      {/* Colour around blocks, then behind all the text */}
      <PopupSlot
        open={popup === 'box'}
        placement="top"
        dialogLabel={t('colorBox')}
        onClose={close}
        button={
          <ToolButton
            icon={icons.box}
            haspopup="dialog"
            label={t('colorBox')}
            active={Boolean(state.box)}
            expanded={popup === 'box'}
            onClick={() => toggle('box')}
          />
        }
      >
        <div className="rich-editor__box-popup">
          <ColorPicker<BoxColorKind>
            label={t('colorBox')}
            tabs={[
              { value: 'backgroundColor', label: t('colorBackground') },
              { value: 'color', label: t('colorText') },
              { value: 'borderColor', label: t('colorBorder') },
            ]}
            value={state.box ?? { backgroundColor: null, color: null, borderColor: null }}
            // Text the box's background (else what is around it) would hide; a
            // background is always offered: the text turns black or white with it.
            unreadable={(kind, color) =>
              kind === 'color' &&
              !readableOn(color, state.box?.backgroundColor ?? state.boxUnder.backgroundColor)
            }
            onPick={(kind, color) => {
              actions.boxColor(kind, color);
              close();
            }}
          />
          {state.box && (
            <button
              type="button"
              className="rich-editor__ui-btn"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                actions.removeBox();
                close();
              }}
            >
              {t('colorBoxRemove')}
            </button>
          )}
        </div>
      </PopupSlot>
      <PopupSlot
        open={popup === 'page'}
        placement="top"
        dialogLabel={t('pageBackground')}
        onClose={close}
        button={
          <ToolButton
            icon={icons.page}
            haspopup="dialog"
            label={t('pageBackground')}
            active={Boolean(state.page.backgroundColor || state.page.color)}
            expanded={popup === 'page'}
            onClick={() => toggle('page')}
          />
        }
      >
        <ColorPicker<TextColorKind>
          label={t('pageBackground')}
          tabs={[
            { value: 'backgroundColor', label: t('colorBackground') },
            { value: 'color', label: t('colorText') },
          ]}
          value={state.page}
          // Text the page background would hide; a background is always offered: the
          // text turns black or white with it.
          unreadable={(kind, color) =>
            kind === 'color' && !readableOn(color, state.page.backgroundColor)
          }
          onPick={(kind, color) => {
            actions.pageColor(kind, color);
            close();
          }}
        />
      </PopupSlot>
    </>
  );
}

/** The link form: URL, Text, Open in new tab, Unlink / Insert. */
function LinkForm({
  link,
  initial,
  onDone,
}: {
  link: LinkAdapter;
  initial: LinkInitial;
  onDone: () => void;
}) {
  const { t } = useT(messages);
  const [value, setValue] = useState<LinkValue>(initial);
  // The text is replaced only when the admin edits it, so bold or a line break
  // inside an existing link survive an address change.
  const [textEdited, setTextEdited] = useState(false);
  const [error, setError] = useState<'required' | 'protocol' | null>(null);
  const urlId = useId();
  const textId = useId();
  const messageId = useId();
  const set = (patch: Partial<LinkValue>) => setValue((v) => ({ ...v, ...patch }));

  function submit() {
    const href = value.href.trim();
    if (!href) return setError('required');
    if (!LINK_PROTOCOL.test(href)) return setError('protocol');
    link.apply({ ...value, href, text: textEdited ? value.text : undefined });
    onDone();
  }

  return (
    <form
      className="rich-editor__form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="rich-editor__field">
        <label htmlFor={urlId}>{t('linkUrl')}</label>
        <input
          id={urlId}
          autoFocus
          type="url"
          inputMode="url"
          className="rich-editor__input"
          placeholder="https://"
          aria-invalid={error !== null}
          aria-describedby={messageId}
          value={value.href}
          onChange={(e) => {
            set({ href: e.target.value });
            setError(null);
          }}
        />
      </div>
      <div className="rich-editor__field">
        <label htmlFor={textId}>{t('linkText')}</label>
        <input
          id={textId}
          className="rich-editor__input"
          value={value.text}
          onChange={(e) => {
            set({ text: e.target.value });
            setTextEdited(true);
          }}
        />
      </div>
      <label className="rich-editor__check">
        <input
          type="checkbox"
          checked={value.newTab}
          onChange={(e) => set({ newTab: e.target.checked })}
        />
        {t('linkNewTab')}
      </label>
      <p
        id={messageId}
        // Always a live region, so the error is announced when it appears.
        aria-live="assertive"
        className="rich-editor__hint"
        data-error={error ? true : undefined}
      >
        {error === 'required'
          ? t('linkRequired')
          : error === 'protocol'
            ? t('linkInvalid')
            : t('linkHint')}
      </p>
      <div className="rich-editor__form-actions">
        {initial.isLink ? (
          <button
            type="button"
            className="rich-editor__ui-btn"
            onClick={() => {
              link.unlink();
              onDone();
            }}
          >
            {t('unlink')}
          </button>
        ) : (
          <span />
        )}
        <button type="submit" className="rich-editor__ui-btn rich-editor__ui-btn_primary">
          {initial.isLink ? t('linkUpdate') : t('linkInsert')}
        </button>
      </div>
    </form>
  );
}

/**
 * The popup on a clicked link: Open / Edit / Unlink, with Edit turning into the
 * link form in place. Positioned under the link inside the editor frame.
 */
export function LinkBubble({
  anchor,
  link,
  autoFocus,
  onClose,
}: {
  anchor: HTMLAnchorElement;
  link: LinkAdapter;
  autoFocus?: boolean;
  onClose: () => void;
}) {
  const { t } = useT(messages);
  // Null while the buttons show; the form's starting value once Edit is pressed.
  const [editing, setEditing] = useState<LinkInitial | null>(null);
  const href = anchor.getAttribute('href') ?? '';
  return (
    <Bubble
      anchor={anchor}
      keepOn=".rich-text-editable a"
      autoFocus={autoFocus}
      width={editing ? 320 : 110}
      label={t('link')}
      onClose={onClose}
      onEscape={() => {
        onClose();
        link.restore();
      }}
    >
      {editing ? (
        <div className="rich-editor__bubble-form">
          <LinkForm link={link} initial={editing} onDone={onClose} />
        </div>
      ) : (
        <div role="toolbar" aria-label={t('link')} className="rich-editor__bubble-bar">
          <ToolButton
            icon={icons.eye}
            label={t('openLink')}
            disabled={!LINK_PROTOCOL.test(href.trim())}
            onClick={() => window.open(href.trim(), '_blank', 'noopener,noreferrer')}
          />
          <ToolButton
            icon={icons.pencil}
            label={t('editLink')}
            onClick={() => setEditing(link.read())}
          />
          <ToolButton
            icon={icons.unlink}
            label={t('unlink')}
            onClick={() => {
              link.unlink();
              onClose();
            }}
          />
        </div>
      )}
    </Bubble>
  );
}

export function EditorShell({
  toolbar,
  overlay,
  children,
}: {
  toolbar: ReactNode;
  /** Floats over the editing surface, e.g. the link bubble. */
  overlay?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useT(messages);
  const ref = useRef<HTMLDivElement>(null);
  // Toolbar pattern: one Tab stop (the last button used), arrows for the rest.
  // Buttons inside an open popup keep their own Tab order.
  const stopRef = useRef<HTMLElement | null>(null);
  const toolbarButtons = () =>
    Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? []).filter(
      (b) => !b.closest('.rich-editor__popup'),
    );
  const assignStop = () => {
    const buttons = toolbarButtons();
    const enabled = buttons.filter((b) => !b.disabled);
    const stop = enabled.find((b) => b === stopRef.current) ?? enabled[0];
    buttons.forEach((b) => (b.tabIndex = b === stop ? 0 : -1));
  };
  // After every render: buttons come and go, and undo/redo turn on and off.
  useEffect(assignStop);
  return (
    <div className="rich-editor">
      <div
        ref={ref}
        role="toolbar"
        aria-label={t('toolbar')}
        className="rich-editor__toolbar"
        onFocus={(e) => {
          const button = (e.target as Element).closest('button');
          if (button && !button.closest('.rich-editor__popup')) {
            stopRef.current = button;
            assignStop();
          }
        }}
        onKeyDown={(e) => {
          // Left / right walk the toolbar; keys inside an open popup are the popup's.
          if ((e.target as Element).closest('.rich-editor__popup')) return;
          moveFocus(e, ref.current, { next: ['ArrowRight'], prev: ['ArrowLeft'] });
        }}
      >
        {toolbar}
      </div>
      {children}
      {overlay}
    </div>
  );
}
