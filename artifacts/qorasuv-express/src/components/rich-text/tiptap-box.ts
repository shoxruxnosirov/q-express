import { Node } from '@tiptap/react';
import type { Attrs, ResolvedPos } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { findWrapping } from '@tiptap/pm/transform';

/**
 * The coloured box: a <div> with a background, a border and a text colour around
 * paragraphs, lists or tables — a notice set apart inside the conditions. Stored as
 * inline CSS, so it looks the same wherever the HTML is shown.
 */
export const BOX = 'colorBox';

/** The border a new box starts with, so even one without a background shows its edge. */
export const BOX_BORDER = '#DADADA';

const colorAttr = (property: string) => ({
  default: null,
  parseHTML: (el: HTMLElement) => el.style.getPropertyValue(property) || null,
  // Written by the node's own renderHTML, with the box's padding.
  renderHTML: () => ({}),
});

export const ColorBox = Node.create({
  name: BOX,
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      backgroundColor: colorAttr('background-color'),
      color: colorAttr('color'),
      borderColor: colorAttr('border-color'),
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div',
        // Only a <div> that shows as a box (a background or a border). Any other
        // (Word's sections, a plain wrapper) is still read as the paragraphs inside.
        getAttrs: (el: HTMLElement) =>
          el.style.backgroundColor || el.style.borderColor ? null : false,
      },
    ];
  },

  renderHTML({ node }) {
    const { backgroundColor, color, borderColor } = node.attrs;
    const style = [
      'padding: 0.6em 0.8em;',
      'border-radius: 4px;',
      backgroundColor && `background-color: ${backgroundColor};`,
      color && `color: ${color};`,
      borderColor && `border: 1px solid ${borderColor};`,
    ]
      .filter(Boolean)
      .join(' ');
    return ['div', { style }, 0];
  },
});

/** The position of the innermost box around `$pos`, or null. */
export function boxAround($pos: ResolvedPos): number | null {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.name === BOX) return $pos.before(depth);
  }
  return null;
}

/** Parts of a list or a table: a box takes the whole list or table, not a piece of it. */
const WHOLE_ONLY = new Set(['listItem', 'bulletList', 'orderedList', 'tableRow', 'table']);

/**
 * Puts the selected blocks in a new box; returns its position, or null when they
 * cannot be wrapped. A selection in a list item takes the whole list (a box cannot
 * hold one item of it); one across cells, the whole table. Inside one cell, the
 * box goes in the cell.
 */
export function wrapInBox(tr: Transaction, attrs: Attrs): number | null {
  const { $from, $to } = tr.selection;
  const range = $from.blockRange($to, (node) => !WHOLE_ONLY.has(node.type.name));
  const wrapping = range && findWrapping(range, tr.doc.type.schema.nodes[BOX], attrs);
  if (!range || !wrapping) return null;
  tr.wrap(range, wrapping);
  return range.start;
}

/** Takes the box at `pos` away, leaving what was in it. */
export function unwrapBox(tr: Transaction, pos: number) {
  const box = tr.doc.nodeAt(pos);
  if (box?.type.name === BOX) tr.replaceWith(pos, pos + box.nodeSize, box.content);
}
