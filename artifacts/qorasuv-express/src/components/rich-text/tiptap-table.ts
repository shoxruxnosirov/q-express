import { Extension, type Editor } from '@tiptap/react';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import type { Attrs, Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { CellSelection, TableMap, cellAround, selectedRect } from '@tiptap/pm/tables';
import { isHistoryTransaction } from '@tiptap/pm/history';
import type { EditorView } from '@tiptap/pm/view';

/**
 * Tables: insert, add/delete rows and columns, merge,
 * split, per-cell colours, vertical and horizontal alignment, header row,
 * column resizing, Tab navigation. Cell styling is stored as inline CSS so the
 * HTML renders the same anywhere it is shown.
 */

/** The cell attribute `name`, kept as the inline CSS property `property`. */
function styleAttr(name: string, property: string) {
  return {
    default: null,
    parseHTML: (el: HTMLElement) => el.style.getPropertyValue(property) || null,
    renderHTML: (attrs: Record<string, unknown>) =>
      attrs[name] ? { style: `${property}: ${attrs[name]}` } : {},
  };
}

const CELL_ALIGNS = ['left', 'center', 'right', 'justify'];

function cellAttributes() {
  return {
    backgroundColor: styleAttr('backgroundColor', 'background-color'),
    color: styleAttr('color', 'color'),
    borderColor: styleAttr('borderColor', 'border-color'),
    verticalAlign: styleAttr('verticalAlign', 'vertical-align'),
    // Tiptap's own `align` knows left/center/right only; the cell popup adds justify.
    align: {
      default: null,
      parseHTML: (el: HTMLElement) => {
        const v = (el.style.textAlign || el.getAttribute('align') || '').toLowerCase();
        return CELL_ALIGNS.includes(v) ? v : null;
      },
      renderHTML: (attrs: Record<string, unknown>) =>
        attrs.align ? { style: `text-align: ${attrs.align}` } : {},
    },
  };
}

const StyledCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttributes() };
  },
});

const StyledHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttributes() };
  },
});

/**
 * Column widths for the cells of one table that has some but not all of them: the
 * missing ones measured from the rendered cells. Null when nothing is missing or a
 * column cannot be measured (e.g. the editor is hidden).
 */
function measuredWidths(view: EditorView, table: PmNode, start: number): number[] | null {
  const map = TableMap.get(table);
  const widths: (number | null)[] = Array(map.width).fill(null);
  map.map.forEach((cellPos, i) => {
    const col = i % map.width;
    const cell = table.nodeAt(cellPos)!;
    const width = cell.attrs.colwidth?.[col - map.findCell(cellPos).left];
    if (width && widths[col] === null) widths[col] = width;
  });
  const known = widths.filter((w) => w !== null).length;
  if (known === 0 || known === map.width) return null;
  for (let col = 0; col < map.width; col += 1) {
    for (let row = 0; row < map.height && widths[col] === null; row += 1) {
      const cellPos = map.map[row * map.width + col];
      if ((table.nodeAt(cellPos)!.attrs.colspan ?? 1) !== 1) continue;
      const dom = view.nodeDOM(start + cellPos) as HTMLElement | null;
      const width = Math.round(dom?.getBoundingClientRect().width ?? 0);
      if (width > 0) widths[col] = width;
    }
  }
  return widths.every((w) => w !== null) ? (widths as number[]) : null;
}

/**
 * Dragging one column gives only that column a width; the others stay "auto". The
 * stored HTML turns widths into percentages (rich-html.ts), which needs all of them,
 * so the moment a table is part-sized the rest are filled in from what is on screen.
 */
const completeKey = new PluginKey<Transaction | null>('completeColumnWidths');

const CompleteColumnWidths = Extension.create({
  name: 'completeColumnWidths',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: completeKey,
        // The transaction behind the current state, so the completion can join its
        // undo step (and stay out of an undo or redo).
        state: {
          init: () => null,
          apply: (tr) => tr,
        },
        view: () => ({
          update: (view, prevState) => {
            // Widths only change with the document; selection moves need no walk.
            if (prevState && prevState.doc === view.state.doc) return;
            const cause = completeKey.getState(view.state);
            // Undo/redo restore widths as they were — completing them again would turn
            // an undone drag into fixed widths the admin never set.
            if (cause && isHistoryTransaction(cause)) return;
            let tr: Transaction | null = null;
            view.state.doc.descendants((node, pos) => {
              if (node.type.spec.tableRole !== 'table') return true;
              const widths = measuredWidths(view, node, pos + 1);
              if (!widths) return false;
              tr ??= view.state.tr;
              const map = TableMap.get(node);
              new Set(map.map).forEach((cellPos) => {
                const cell = node.nodeAt(cellPos)!;
                const { left, right } = map.findCell(cellPos);
                tr!.setNodeMarkup(pos + 1 + cellPos, null, {
                  ...cell.attrs,
                  colwidth: widths.slice(left, right),
                });
              });
              return false;
            });
            // Part of the drag's own undo step ("appended" to it), so one undo takes the
            // table back to how it was, auto widths included.
            if (tr) {
              const completion = tr as Transaction;
              if (cause) completion.setMeta('appendedTransaction', cause);
              view.dispatch(completion);
            }
          },
        }),
      }),
    ];
  },
});

export const tableExtensions = [
  // Column widths are dragged; the wrapper div stays out of the saved HTML.
  Table.configure({ resizable: true, cellMinWidth: 40, allowTableNodeSelection: false }),
  TableRow,
  StyledHeader,
  StyledCell,
  CompleteColumnWidths,
];

/** Position (before the node) of the cell the selection's head is in, or null. */
export function currentCellPos(editor: Editor): number | null {
  const { selection } = editor.state;
  if (selection instanceof CellSelection) return selection.$headCell.pos;
  return cellAround(selection.$head)?.pos ?? null;
}

function emptyCellLike(cell: PmNode, attrs: Attrs) {
  return cell.type.createAndFill(attrs);
}

/**
 * "Split vertical / horizontal": the cell under the caret becomes two.
 * A merged cell gives up half its span; a plain cell gets a new neighbour, and
 * every other cell on that column (row) is widened (heightened) by one so the
 * grid stays rectangular.
 */
export function splitCell(editor: Editor, direction: 'vertical' | 'horizontal'): boolean {
  const { state } = editor;
  const absPos = currentCellPos(editor);
  if (absPos === null) return false;
  const { map, table, tableStart } = selectedRect(state);
  // Positions in a TableMap are relative to the table's content start.
  const relPos = absPos - tableStart;
  const cell = table.nodeAt(relPos);
  if (!cell) return false;
  const rect = map.findCell(relPos);
  const colspan: number = cell.attrs.colspan ?? 1;
  const rowspan: number = cell.attrs.rowspan ?? 1;
  const colwidth: number[] | null = cell.attrs.colwidth ?? null;
  const tr = state.tr;

  if (direction === 'vertical') {
    if (colspan > 1) {
      const first = Math.ceil(colspan / 2);
      tr.setNodeMarkup(tableStart + relPos, null, {
        ...cell.attrs,
        colspan: first,
        colwidth: colwidth ? colwidth.slice(0, first) : null,
      });
      const added = emptyCellLike(cell, {
        colspan: colspan - first,
        rowspan,
        colwidth: colwidth ? colwidth.slice(first) : null,
      });
      if (!added) return false;
      tr.insert(tableStart + relPos + cell.nodeSize, added);
    } else {
      const seen = new Set<number>([relPos]);
      for (let row = 0; row < map.height; row += 1) {
        const pos = map.map[row * map.width + rect.left];
        if (seen.has(pos)) continue;
        seen.add(pos);
        const other = table.nodeAt(pos)!;
        tr.setNodeMarkup(tableStart + pos, null, {
          ...other.attrs,
          colspan: (other.attrs.colspan ?? 1) + 1,
          colwidth: null,
        });
      }
      tr.setNodeMarkup(tableStart + relPos, null, { ...cell.attrs, colwidth: null });
      const added = emptyCellLike(cell, { colspan: 1, rowspan });
      if (!added) return false;
      tr.insert(tableStart + relPos + cell.nodeSize, added);
    }
  } else if (rowspan > 1) {
    const first = Math.ceil(rowspan / 2);
    tr.setNodeMarkup(tableStart + relPos, null, { ...cell.attrs, rowspan: first });
    const added = emptyCellLike(cell, { colspan, rowspan: rowspan - first, colwidth });
    if (!added) return false;
    tr.insert(tableStart + map.positionAt(rect.top + first, rect.left, table), added);
  } else {
    const seen = new Set<number>([relPos]);
    for (let col = 0; col < map.width; col += 1) {
      const pos = map.map[rect.top * map.width + col];
      if (seen.has(pos)) continue;
      seen.add(pos);
      const other = table.nodeAt(pos)!;
      tr.setNodeMarkup(tableStart + pos, null, {
        ...other.attrs,
        rowspan: (other.attrs.rowspan ?? 1) + 1,
      });
    }
    let rowEnd = tableStart;
    for (let i = 0; i <= rect.top; i += 1) rowEnd += table.child(i).nodeSize;
    const added = emptyCellLike(cell, { colspan, rowspan: 1, colwidth });
    if (!added) return false;
    tr.insert(rowEnd, table.child(rect.top).type.create(null, added));
  }
  editor.view.dispatch(tr.scrollIntoView());
  editor.commands.focus();
  return true;
}

/** "Empty cells": clears the selected cells, keeps the table shape. */
export function emptyCells(editor: Editor): boolean {
  if (currentCellPos(editor) === null) return false;
  const rect = selectedRect(editor.state);
  const tr = editor.state.tr;
  // From the last cell back, so earlier positions stay valid.
  [...rect.map.cellsInRect(rect)]
    .sort((a, b) => b - a)
    .forEach((pos) => {
      const cell = rect.table.nodeAt(pos);
      const filler = cell?.type.contentMatch.defaultType?.createAndFill();
      if (!cell || !filler) return;
      const start = rect.tableStart + pos + 1;
      tr.replaceWith(start, start + cell.content.size, filler);
    });
  editor.view.dispatch(tr);
  editor.commands.focus();
  return true;
}

/** Whether the first row of the table around the selection is a header row. */
export function firstRowIsHeader(editor: Editor): boolean {
  const { $head } = editor.state.selection;
  for (let depth = $head.depth; depth > 0; depth -= 1) {
    const node = $head.node(depth);
    if (node.type.name !== 'table') continue;
    const row = node.firstChild;
    if (!row?.childCount) return false;
    let header = true;
    row.forEach((cell) => {
      if (cell.type.name !== 'tableHeader') header = false;
    });
    return header;
  }
  return false;
}
