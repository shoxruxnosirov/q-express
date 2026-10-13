import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useT } from '@/i18n';
import messages from '@/i18n/messages/richText';
import { readableOn } from '../../lib/rich-html';
import { ColorPicker } from './color-picker';
import { icons } from './toolbar-icons';
import { Bubble, Menu, PopupSlot, ToolButton, type TextAlign } from './chrome-primitives';

/**
 * Table chrome in the Jodit look: the 10×10 size picker on the toolbar and the
 * popup on a table cell (colours, alignment, split, merge, add, delete).
 * Engine-agnostic: the editor maps TableActions onto its own commands.
 */

type CellColorKind = 'backgroundColor' | 'color' | 'borderColor';
type VAlign = 'top' | 'middle' | 'bottom';

/** What the cell popup shows for the selected cell(s). */
export interface TableState {
  canMerge: boolean;
  headerRow: boolean;
  valign: VAlign | null;
  align: TextAlign | null;
  colors: Record<CellColorKind, string | null>;
  /** The colours around the cell (a coloured box it sits in). */
  under: { color: string | null; backgroundColor: string | null };
}

export interface TableActions {
  setColor: (kind: CellColorKind, color: string | null) => void;
  setVAlign: (to: VAlign | null) => void;
  setAlign: (to: TextAlign | null) => void;
  split: (direction: 'vertical' | 'horizontal') => void;
  merge: () => void;
  addColumn: (side: 'before' | 'after') => void;
  addRow: (side: 'before' | 'after') => void;
  deleteTable: () => void;
  deleteRow: () => void;
  deleteColumn: () => void;
  emptyCells: () => void;
  toggleHeaderRow: () => void;
}

const PICKER_SIZE = 10;

/**
 * The table inserter: hover (or arrow keys) to size, click (or Enter) to insert.
 * The grid holds focus and points at the current size with aria-activedescendant.
 */
export function TablePicker({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const { t } = useT(messages);
  const id = useId();
  const [size, setSize] = useState({ rows: 1, cols: 1 });
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => gridRef.current?.focus(), []);
  const cellId = (rows: number, cols: number) => `${id}-${rows}-${cols}`;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const clamp = (n: number) => Math.min(PICKER_SIZE, Math.max(1, n));
    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    if (moves[e.key]) {
      e.preventDefault();
      const [dr, dc] = moves[e.key];
      setSize((s) => ({ rows: clamp(s.rows + dr), cols: clamp(s.cols + dc) }));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPick(size.rows, size.cols);
    }
  }

  return (
    <div className="rich-editor__table-picker">
      <div
        ref={gridRef}
        role="grid"
        aria-label={t('tableSize')}
        aria-rowcount={PICKER_SIZE}
        aria-colcount={PICKER_SIZE}
        aria-activedescendant={cellId(size.rows, size.cols)}
        tabIndex={0}
        className="rich-editor__table-grid"
        onKeyDown={onKeyDown}
      >
        {Array.from({ length: PICKER_SIZE }, (_, r) => (
          <div key={r} role="row" className="rich-editor__table-row">
            {Array.from({ length: PICKER_SIZE }, (_, c) => {
              const rows = r + 1;
              const cols = c + 1;
              const on = rows <= size.rows && cols <= size.cols;
              return (
                <span
                  key={c}
                  id={cellId(rows, cols)}
                  role="gridcell"
                  aria-selected={on}
                  aria-label={`${rows} × ${cols}`}
                  className="rich-editor__table-cell"
                  data-on={on || undefined}
                  onMouseEnter={() => setSize({ rows, cols })}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onPick(rows, cols)}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="rich-editor__table-size" aria-live="polite">
        {size.rows} × {size.cols}
      </div>
    </div>
  );
}

type CellPopup = 'brush' | 'valign' | 'split' | 'align' | 'addcolumn' | 'addrow' | 'delete';

/**
 * The popup on a table cell, in two rows:
 * colour · vertical align · split · align / merge · add column · add row · delete,
 * plus a header-row toggle. Opened by a click in a cell, or from the keyboard
 * (Alt+F10) with focus on its first button.
 */
export function TableBubble({
  anchor,
  state,
  actions,
  autoFocus,
  onClose,
  onEscape,
}: {
  /** The cell, read on every render: the editor re-creates cells as the table changes. */
  anchor: () => HTMLElement | null;
  state: TableState;
  actions: TableActions;
  autoFocus?: boolean;
  onClose: () => void;
  /** Esc in the popup: close it and give the text its focus back. */
  onEscape: () => void;
}) {
  const { t } = useT(messages);
  const [popup, setPopup] = useState<CellPopup | null>(null);

  const toggle = (name: CellPopup) => {
    if (popup !== name) {
      setPopup(name);
      return;
    }
    // Closed by its own button while focus was inside: focus would fall to the page
    // as the dropdown goes, so it returns to that button (the cell popup stays open).
    const trigger = document.activeElement
      ?.closest('.rich-editor__slot')
      ?.querySelector<HTMLElement>('[aria-haspopup]');
    setPopup(null);
    trigger?.focus();
  };
  const close = () => setPopup(null);
  // Runs a command and closes the sub-menu, keeping the cell popup open.
  const run = (fn: () => void) => {
    fn();
    close();
  };

  const slot = (name: CellPopup, button: ReactNode, content: ReactNode) => (
    // Dropdowns open upwards (off the table and the text) when there is room. The colour
    // picker is a small form (tabs, palette), so a named dialog rather than a menu.
    <PopupSlot
      open={popup === name}
      onClose={close}
      button={button}
      placement="top"
      dialogLabel={name === 'brush' ? t('cellColor') : undefined}
    >
      {content}
    </PopupSlot>
  );
  const menuButton = (name: CellPopup, icon: ReactNode, label: string, active = false) => (
    <ToolButton
      icon={icon}
      label={label}
      active={active}
      trigger
      haspopup={name === 'brush' ? 'dialog' : 'menu'}
      expanded={popup === name}
      onClick={() => toggle(name)}
    />
  );
  const alignLabel: Record<TextAlign, string> = {
    center: t('alignCenter'),
    left: t('alignLeft'),
    right: t('alignRight'),
    justify: t('alignJustify'),
  };

  return (
    <Bubble
      anchor={anchor}
      keepOn=".rich-text-editable td, .rich-text-editable th"
      autoFocus={autoFocus}
      width={230}
      label={t('table')}
      className="rich-editor__cell-bubble"
      onClose={onClose}
      onEscape={onEscape}
    >
      <div role="toolbar" aria-label={t('cellFormat')} className="rich-editor__bubble-bar">
        {slot(
          'brush',
          menuButton(
            'brush',
            icons.brush,
            t('cellColor'),
            Boolean(state.colors.backgroundColor || state.colors.color || state.colors.borderColor),
          ),
          <ColorPicker<CellColorKind>
            label={t('cellColor')}
            tabs={[
              { value: 'backgroundColor', label: t('colorBackground') },
              { value: 'color', label: t('colorText') },
              { value: 'borderColor', label: t('colorBorder') },
            ]}
            value={state.colors}
            // Text the cell's background would hide; a background is always offered
            // (the editor turns the text black or white to go with it).
            unreadable={(kind, color) =>
              kind === 'color' &&
              !readableOn(color, state.colors.backgroundColor ?? state.under.backgroundColor)
            }
            onPick={(kind, color) => run(() => actions.setColor(kind, color))}
          />,
        )}
        {slot(
          'valign',
          menuButton('valign', icons.valign, t('valign'), state.valign !== null),
          <Menu<VAlign | null>
            label={t('valign')}
            selected={state.valign}
            items={[
              { value: 'top', label: t('valignTop') },
              { value: 'middle', label: t('valignMiddle') },
              { value: 'bottom', label: t('valignBottom') },
              { value: null, label: t('valignNormal') },
            ]}
            onSelect={(v) => run(() => actions.setVAlign(v))}
          />,
        )}
        {slot(
          'split',
          menuButton('split', icons.splitv, t('split')),
          <Menu<'vertical' | 'horizontal'>
            label={t('split')}
            items={[
              { value: 'vertical', label: t('splitVertical') },
              { value: 'horizontal', label: t('splitHorizontal') },
            ]}
            onSelect={(d) => run(() => actions.split(d))}
          />,
        )}
        {slot(
          'align',
          menuButton(
            'align',
            icons[state.align ?? 'left'],
            t('cellAlign'),
            state.align !== null,
          ),
          <Menu<TextAlign | null>
            label={t('cellAlign')}
            selected={state.align}
            items={[
              ...(['center', 'left', 'right', 'justify'] as const).map((a) => ({
                value: a,
                label: (
                  <>
                    <span className="rich-editor__icon">{icons[a]}</span>
                    {alignLabel[a]}
                  </>
                ),
              })),
              { value: null, label: t('valignNormal') },
            ]}
            onSelect={(a) => run(() => actions.setAlign(a))}
          />,
        )}
      </div>
      <div
        role="toolbar"
        aria-label={t('tableStructure')}
        className="rich-editor__bubble-bar"
      >
        <ToolButton
          icon={icons.merge}
          label={t('merge')}
          disabled={!state.canMerge}
          onClick={actions.merge}
        />
        {slot(
          'addcolumn',
          menuButton('addcolumn', icons.addcolumn, t('addColumn')),
          <Menu<'before' | 'after'>
            label={t('addColumn')}
            items={[
              { value: 'before', label: t('addColumnBefore') },
              { value: 'after', label: t('addColumnAfter') },
            ]}
            onSelect={(side) => run(() => actions.addColumn(side))}
          />,
        )}
        {slot(
          'addrow',
          menuButton('addrow', icons.addrow, t('addRow')),
          <Menu<'before' | 'after'>
            label={t('addRow')}
            items={[
              { value: 'before', label: t('addRowBefore') },
              { value: 'after', label: t('addRowAfter') },
            ]}
            onSelect={(side) => run(() => actions.addRow(side))}
          />,
        )}
        {slot(
          'delete',
          menuButton('delete', icons.bin, t('deleteMenu')),
          <Menu<'table' | 'row' | 'column' | 'empty'>
            label={t('deleteMenu')}
            items={[
              { value: 'table', label: t('deleteTable') },
              { value: 'row', label: t('deleteRow') },
              { value: 'column', label: t('deleteColumn') },
              { value: 'empty', label: t('emptyCell') },
            ]}
            onSelect={(what) =>
              run(
                {
                  table: actions.deleteTable,
                  row: actions.deleteRow,
                  column: actions.deleteColumn,
                  empty: actions.emptyCells,
                }[what],
              )
            }
          />,
        )}
        <ToolButton
          icon={icons.tableHeader}
          label={t('headerRow')}
          active={state.headerRow}
          onClick={actions.toggleHeaderRow}
        />
      </div>
    </Bubble>
  );
}
