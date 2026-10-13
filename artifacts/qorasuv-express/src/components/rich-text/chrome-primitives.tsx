import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { icons } from './toolbar-icons';

/**
 * Building blocks shared by the toolbar (editor-chrome) and the table popup
 * (table-chrome): Jodit-look buttons, popups and menus with keyboard support.
 */

export type TextAlign = 'left' | 'center' | 'right' | 'justify';

/** How a popup was dismissed — callers decide where focus goes from it. */
type DismissReason = 'escape' | 'outside' | 'blur';

/**
 * Buttons inside `root` at its own level: those inside a popup opened from `root`
 * belong to that popup (arrows there move within it), not to `root`.
 */
function focusables(root: HTMLElement | null) {
  const level = root?.closest('.rich-editor__popup') ?? null;
  return Array.from(root?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? []).filter(
    (b) => b.closest('.rich-editor__popup') === level,
  );
}

/** Arrow / Home / End move focus through `root`'s buttons; true when the key was used. */
export function moveFocus(
  e: KeyboardEvent,
  root: HTMLElement | null,
  keys: { next: string[]; prev: string[] },
): boolean {
  const items = focusables(root);
  if (!items.length) return false;
  const i = items.indexOf(document.activeElement as HTMLElement);
  let next = -1;
  if (keys.next.includes(e.key)) next = (i + 1) % items.length;
  else if (keys.prev.includes(e.key)) next = (i - 1 + items.length) % items.length;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = items.length - 1;
  if (next < 0) return false;
  e.preventDefault();
  items[next].focus();
  return true;
}

export function ToolButton({
  icon,
  label,
  active,
  disabled,
  expanded,
  haspopup = 'menu',
  trigger,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  /** Set on buttons that open a popup. */
  expanded?: boolean;
  /** What the popup is, for screen readers: a menu, a form (dialog) or a grid. */
  haspopup?: 'menu' | 'dialog' | 'grid';
  /** Show a small down-arrow next to the icon. */
  trigger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="rich-editor__btn"
      aria-label={label}
      aria-pressed={expanded === undefined ? active : undefined}
      aria-haspopup={expanded === undefined ? undefined : haspopup}
      aria-expanded={expanded}
      data-active={active || undefined}
      title={label}
      disabled={disabled}
      // Keep the selection in the editor: a mousedown on the button would blur it first.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <span className="rich-editor__icon">{icon}</span>
      {trigger && <span className="rich-editor__trigger">{icons.chevron}</span>}
    </button>
  );
}

/** A split button: the icon runs the command, the arrow opens its options. */
export function SplitButton({
  icon,
  label,
  menuLabel,
  active,
  expanded,
  onClick,
  onTrigger,
}: {
  icon: ReactNode;
  label: string;
  menuLabel: string;
  active: boolean;
  expanded: boolean;
  onClick: () => void;
  onTrigger: () => void;
}) {
  return (
    <span className="rich-editor__split">
      <ToolButton icon={icon} label={label} active={active} onClick={onClick} />
      <button
        type="button"
        className="rich-editor__btn rich-editor__btn_trigger"
        aria-label={menuLabel}
        aria-haspopup
        aria-expanded={expanded}
        title={menuLabel}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onTrigger}
      >
        <span className="rich-editor__trigger">{icons.chevron}</span>
      </button>
    </span>
  );
}

export function Separator() {
  return <span aria-hidden className="rich-editor__sep" />;
}

/**
 * The top of the area a popup can show in: the line the sticky toolbar stops at
 * (under the fixed topbar and any sticky save bar), plus a margin.
 */
function visibleTop(from: Element | null): number {
  // Where the toolbar sticks is the line popups must stay below: the browser
  // resolves its `top` (topbar + any save bar) to pixels.
  const toolbar = from?.closest('.rich-editor')?.querySelector('.rich-editor__toolbar');
  const parsed = toolbar ? Number.parseFloat(getComputedStyle(toolbar).top) : NaN;
  const stickyTop = Number.isFinite(parsed) ? parsed : 60;
  // A popup outside the toolbar (in a cell bubble) must also clear the toolbar
  // itself, which paints above it; the toolbar's own popups open over it.
  const outside = toolbar && from && !toolbar.contains(from);
  const bottom = outside ? toolbar.getBoundingClientRect().bottom : 0;
  return Math.max(stickyTop, bottom) + 8;
}

/**
 * A slot whose popup opens under its button (or above it, see `placement`). It closes on a press outside, or on
 * Esc from inside — that Esc goes no further (an enclosing popup stays open) and
 * focus returns to the button. Near the right edge of the screen the popup opens
 * leftwards instead of running off it.
 */
export function PopupSlot({
  open,
  onClose,
  button,
  placement = 'bottom',
  dialogLabel,
  children,
}: {
  open: boolean;
  /** Why it closes: Esc, a press outside, or focus moving away (Tab, another field). */
  onClose: (reason: DismissReason) => void;
  button: ReactNode;
  /**
   * Where the popup opens. 'top' keeps a dropdown menu off the text being edited;
   * with no room above (the toolbar stuck under the topbar, the page scrolled), it
   * opens below instead.
   */
  placement?: 'top' | 'bottom';
  /** For a popup that is a form or a picker (not a menu): its name as a dialog. */
  dialogLabel?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  // Sideways shift (px) that keeps the popup on screen.
  const [shift, setShift] = useState(0);
  const [side, setSide] = useState(placement);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onCloseRef.current('outside');
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setShift(0);
      setSide(placement);
      return;
    }
    const rect = popupRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Keep it on screen, 8px from either edge: moved left by what runs off the
    // right, but never past the left edge (a popup wider than the screen is capped
    // by CSS max-width).
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 8 - rect.width));
    setShift(left - rect.left);
    if (placement === 'top' && rect.top < visibleTop(ref.current)) setSide('bottom');
  }, [open, placement]);

  return (
    <span
      ref={ref}
      className="rich-editor__slot"
      onBlur={(e) => {
        // Tab out of the popup (focus moved somewhere else on the page) closes it. No
        // target means focus left the page — e.g. the browser's colour picker opened —
        // and the popup must stay.
        const next = e.relatedTarget as Node | null;
        if (open && next && !ref.current?.contains(next)) onCloseRef.current('blur');
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !open) return;
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current('escape');
        ref.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
      }}
    >
      {button}
      {open && (
        <div
          ref={popupRef}
          className="rich-editor__popup"
          role={dialogLabel ? 'dialog' : undefined}
          aria-label={dialogLabel}
          style={shift ? { left: shift } : undefined}
          data-side={side}
        >
          {children}
        </div>
      )}
    </span>
  );
}

/**
 * A menu. With `selected` it is a choice (format, alignment): its items are radio
 * items and the current one is checked. Without it, it is a list of actions (add
 * row, delete table, list style) and its items are plain menu items. On open,
 * focus goes to the checked item (or the first); arrows, Home and End move it,
 * Enter or Space picks.
 */
export function Menu<T extends string | null>({
  label,
  items,
  selected,
  onSelect,
}: {
  label: string;
  items: { value: T; label: ReactNode }[];
  selected?: T;
  onSelect: (value: T) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // `null` can be the current choice (e.g. "default"); only a missing prop means none.
  const isChoice = selected !== undefined;
  useEffect(() => {
    const buttons = focusables(ref.current);
    (buttons.find((b) => b.getAttribute('aria-checked') === 'true') ?? buttons[0])?.focus();
  }, []);
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="rich-editor__list"
      onKeyDown={(e) => moveFocus(e, ref.current, { next: ['ArrowDown'], prev: ['ArrowUp'] })}
    >
      {items.map((item) => (
        <button
          key={String(item.value)}
          type="button"
          role={isChoice ? 'menuitemradio' : 'menuitem'}
          aria-checked={isChoice ? selected === item.value : undefined}
          tabIndex={-1}
          className="rich-editor__item"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSelect(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A popup floating under an element of the text (a link, a table cell): closes on a
 * press elsewhere (a press on another such element moves it instead) or on Esc,
 * which hands focus back to the text. With `autoFocus` (opened from the keyboard)
 * its first button takes focus; arrows move along its buttons.
 */
export function Bubble({
  anchor,
  keepOn,
  autoFocus,
  width,
  label,
  className,
  onClose,
  onEscape,
  children,
}: {
  /**
   * What the bubble sits under — or a getter for it, read on every render, for
   * content the editor may re-create (a table cell after a column is deleted).
   */
  anchor: HTMLElement | (() => HTMLElement | null);
  /** Presses on elements matching this selector do not close the bubble. */
  keepOn: string;
  autoFocus?: boolean;
  /** Expected width, to keep the bubble inside the editor frame. */
  width: number;
  label: string;
  className?: string;
  onClose: () => void;
  onEscape: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!ref.current?.contains(target) && !target.closest?.(keepOn)) onCloseRef.current();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [keepOn]);
  useEffect(() => {
    if (autoFocus) ref.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  }, [autoFocus]);

  const el = typeof anchor === 'function' ? anchor() : anchor;
  // Detached (the editor replaced it) or gone: nothing to sit under.
  if (!el?.isConnected) return null;
  const frame = el.closest('.rich-editor');
  if (!frame) return null;
  const box = frame.getBoundingClientRect();
  const at = el.getBoundingClientRect();
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={`rich-editor__bubble ${className ?? ''}`}
      style={{
        top: at.bottom - box.top + 6,
        left: Math.max(0, Math.min(at.left - box.left, box.width - width)),
      }}
      onBlur={(e) => {
        // Tab out of the editor closes the bubble (see PopupSlot for why no target is
        // kept). Focus going back to the text does not: every action in the bubble
        // returns focus there, and typing closes it anyway.
        const next = e.relatedTarget as Node | null;
        if (next && !ref.current?.closest('.rich-editor')?.contains(next)) onCloseRef.current();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onEscape();
          return;
        }
        // Keys inside an open dropdown are the dropdown's (it moves its own focus).
        if ((e.target as Element).closest('.rich-editor__popup')) return;
        const bar = (e.target as Element).closest<HTMLElement>('.rich-editor__bubble-bar');
        if (bar) moveFocus(e, bar, { next: ['ArrowRight'], prev: ['ArrowLeft'] });
      }}
    >
      {children}
    </div>
  );
}
