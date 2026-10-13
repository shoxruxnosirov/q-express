import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useT } from '@/i18n';
import messages from '@/i18n/messages/richText';

/**
 * The colour widget, for cells (background / text / border), text, the coloured box
 * and the page background
 * (text / background): tabs over one palette, "no colour" and the browser's picker.
 */

/** The palette: greyscale, bright, then the 60 shades. */
const PALETTE = [
  '#000000',
  '#434343',
  '#666666',
  '#999999',
  '#B7B7B7',
  '#CCCCCC',
  '#D9D9D9',
  '#EFEFEF',
  '#F3F3F3',
  '#FFFFFF',
  '#980000',
  '#FF0000',
  '#FF9900',
  '#FFFF00',
  '#00F0F0',
  '#00FFFF',
  '#4A86E8',
  '#0000FF',
  '#9900FF',
  '#FF00FF',
  '#E6B8AF',
  '#F4CCCC',
  '#FCE5CD',
  '#FFF2CC',
  '#D9EAD3',
  '#D0E0E3',
  '#C9DAF8',
  '#CFE2F3',
  '#D9D2E9',
  '#EAD1DC',
  '#DD7E6B',
  '#EA9999',
  '#F9CB9C',
  '#FFE599',
  '#B6D7A8',
  '#A2C4C9',
  '#A4C2F4',
  '#9FC5E8',
  '#B4A7D6',
  '#D5A6BD',
  '#CC4125',
  '#E06666',
  '#F6B26B',
  '#FFD966',
  '#93C47D',
  '#76A5AF',
  '#6D9EEB',
  '#6FA8DC',
  '#8E7CC3',
  '#C27BA0',
  '#A61C00',
  '#CC0000',
  '#E69138',
  '#F1C232',
  '#6AA84F',
  '#45818E',
  '#3C78D8',
  '#3D85C6',
  '#674EA7',
  '#A64D79',
  '#85200C',
  '#990000',
  '#B45F06',
  '#BF9000',
  '#38761D',
  '#134F5C',
  '#1155CC',
  '#0B5394',
  '#351C75',
  '#733554',
  '#5B0F00',
  '#660000',
  '#783F04',
  '#7F6000',
  '#274E13',
  '#0C343D',
  '#1C4587',
  '#073763',
  '#20124D',
  '#4C1130',
];
const PALETTE_COLUMNS = 10;

/**
 * A colour as `#rrggbb`, whichever way it was written: the browser turns stored
 * `#FFF2CC` into `rgb(255, 242, 204)`, and the palette must still recognise it.
 */
function toHex(color: string | null): string | null {
  if (!color) return null;
  const c = color.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(c)) return c;
  if (/^#[0-9a-f]{3}$/.test(c)) return `#${[...c.slice(1)].map((x) => x + x).join('')}`;
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(c);
  if (!rgb) return null;
  return `#${rgb
    .slice(1, 4)
    .map((n) => Number(n).toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * Tabs over one palette. The palette is one tab stop; arrows move through it (10
 * per row). A colour `unreadable` says would not show on what is behind it stays
 * in its place (the grid keeps its shape) but cannot be picked: saving would drop
 * it (the sanitiser's contrast rule).
 */
export function ColorPicker<K extends string>({
  label,
  tabs,
  value,
  onPick,
  unreadable,
}: {
  /** Name of the tab list, e.g. "Cell colour". */
  label: string;
  tabs: { value: K; label: string }[];
  value: Record<K, string | null>;
  onPick: (kind: K, color: string | null) => void;
  unreadable?: (kind: K, color: string) => boolean;
}) {
  const { t } = useT(messages);
  const [kind, setKind] = useState<K>(tabs[0].value);
  const current = toHex(value[kind]);
  const selectedIndex = PALETTE.findIndex((c) => c.toLowerCase() === current);
  const [focusIndex, setFocusIndex] = useState(Math.max(0, selectedIndex));
  // A custom colour that was refused, until another tab or colour is chosen.
  const [refused, setRefused] = useState(false);
  const swatchesRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const hintId = useId();
  const blocked = (c: string) => unreadable?.(kind, c) ?? false;
  const anyBlocked = PALETTE.some(blocked);
  // Another tab: the palette's one tab stop moves to that kind's current colour.
  const chooseKind = (next: K) => {
    setKind(next);
    setRefused(false);
    const hex = toHex(value[next]);
    setFocusIndex(
      Math.max(
        0,
        PALETTE.findIndex((c) => c.toLowerCase() === hex),
      ),
    );
  };
  useEffect(() => {
    swatchesRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  }, []);

  function onSwatchKey(e: KeyboardEvent<HTMLDivElement>) {
    const step = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: PALETTE_COLUMNS,
      ArrowUp: -PALETTE_COLUMNS,
    }[e.key];
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? PALETTE.length - 1 : step ? focusIndex + step : -1;
    if (next < 0 || next >= PALETTE.length) return;
    e.preventDefault();
    setFocusIndex(next);
    swatchesRef.current?.querySelectorAll<HTMLElement>('button')[next]?.focus();
  }

  return (
    <div className="rich-editor__colors">
      <div
        role="tablist"
        aria-label={label}
        className="pill-tabs pill-tabs_fill"
        onKeyDown={(e) => {
          // Tabs pattern: left / right move between the tabs and select.
          const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
          if (!step) return;
          e.preventDefault();
          const i = tabs.findIndex((tab) => tab.value === kind);
          const next = (i + step + tabs.length) % tabs.length;
          chooseKind(tabs[next].value);
          e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={kind === tab.value}
            aria-controls={panelId}
            tabIndex={kind === tab.value ? 0 : -1}
            className="pill-tab"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => chooseKind(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        ref={swatchesRef}
        id={panelId}
        role="listbox"
        aria-label={tabs.find((tab) => tab.value === kind)!.label}
        aria-describedby={anyBlocked ? hintId : undefined}
        className="rich-editor__swatches"
        onKeyDown={onSwatchKey}
      >
        {PALETTE.map((c, i) => (
          <button
            key={c}
            type="button"
            role="option"
            aria-selected={i === selectedIndex}
            aria-disabled={blocked(c) || undefined}
            aria-label={c}
            title={blocked(c) ? `${c} — ${t('colorUnreadable')}` : c}
            tabIndex={i === focusIndex ? 0 : -1}
            className="rich-editor__swatch"
            style={{ backgroundColor: c }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => !blocked(c) && onPick(kind, c)}
          />
        ))}
      </div>
      {(anyBlocked || refused) && (
        <p
          id={hintId}
          role="status"
          className="rich-editor__hint"
          data-error={refused || undefined}
        >
          {t('colorUnreadable')}
        </p>
      )}
      <div className="rich-editor__color-actions">
        <button
          type="button"
          className="rich-editor__ui-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(kind, null)}
        >
          {t('colorNone')}
        </button>
        <CustomColor
          // A fresh input per tab and colour, so it starts from the current one.
          key={`${kind}-${current}`}
          label={t('colorCustom')}
          value={current ?? '#000000'}
          onPick={(color) => {
            if (blocked(color)) setRefused(true);
            else onPick(kind, color);
          }}
        />
      </div>
    </div>
  );
}

/**
 * The browser's own colour picker. React's onChange on a colour input fires on
 * every `input` event — each step of a drag in Chrome's picker — and a pick closes
 * this popup, so the first step would end it. The native `change` event fires
 * once, when the admin closes the picker with the colour they settled on.
 */
function CustomColor({
  label,
  value,
  onPick,
}: {
  label: string;
  value: string;
  onPick: (color: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const onPickRef = useRef(onPick);
  useEffect(() => {
    onPickRef.current = onPick;
  });
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    const pick = () => onPickRef.current(input.value.toUpperCase());
    input.addEventListener('change', pick);
    return () => input.removeEventListener('change', pick);
  }, []);
  return (
    <label className="rich-editor__custom-color">
      {label}
      <input ref={ref} type="color" defaultValue={value} />
    </label>
  );
}
