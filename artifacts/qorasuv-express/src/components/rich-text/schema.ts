import { Extension, Node } from '@tiptap/react';
import type { TagParseRule } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { BackgroundColor, Color, TextStyle } from '@tiptap/extension-text-style';
import { isFontSize, LINK_PROTOCOL, listStyleForType } from '../../lib/rich-html';
import { ColorBox } from './tiptap-box';
import { tableExtensions } from './tiptap-table';

/**
 * The editor's schema: every node, mark and attribute HTML can come in as. Shared by
 * the editor (tiptap-editor.tsx, which adds its behaviour on top) and by saving
 * (editor-form.ts), so what is stored is what the editor would make of it.
 */

export const HEADINGS = [1, 2, 3, 4] as const;

/**
 * A list's marker style: on the list itself; else on its first item (Google Docs
 * puts it on every <li>); else from the old `type` attribute. Not read, they would
 * paste as 1, 2, 3 — the saved HTML keeps only the style.
 */
function listStyleOf(list: HTMLElement): string | null {
  const item = list.firstElementChild as HTMLElement | null;
  return (
    list.style.listStyleType ||
    (item?.tagName === 'LI' ? item.style.listStyleType : '') ||
    listStyleForType(list.getAttribute('type')) ||
    null
  );
}

/** List marker styles (circle, square, lower-roman…) as `style="list-style-type"`. */
const ListStyle = Extension.create({
  name: 'listStyle',
  addGlobalAttributes() {
    return [
      {
        types: ['bulletList', 'orderedList'],
        attributes: {
          listStyleType: {
            default: null,
            parseHTML: listStyleOf,
            renderHTML: (attrs) =>
              attrs.listStyleType ? { style: `list-style-type: ${attrs.listStyleType}` } : {},
          },
        },
      },
    ];
  },
});

/**
 * Coloured or sized text: Tiptap's <span> mark, read only from spans that carry a
 * colour or one of the editor's sizes.
 * Its own rule takes any span with a style, so Google Docs' `<span style="font-weight:700">`
 * would come in as an empty mark and save as a bare <span> around every run of text.
 */
const ColoredText = TextStyle.extend({
  parseHTML() {
    return (this.parent?.() ?? []).map((rule) => {
      const tagRule = rule as TagParseRule;
      return {
        ...tagRule,
        getAttrs: (node: HTMLElement) =>
          node.style.color || node.style.backgroundColor || isFontSize(node.style.fontSize)
            ? (tagRule.getAttrs?.(node) ?? null)
            : false,
      };
    });
  },
});

/**
 * The size of a run of text, one of FONT_SIZES and nothing else: Tiptap's own
 * FontSize would keep any size pasted from a word processor ("11pt"), which the
 * sanitiser then drops, so the editor would show what the page never does.
 */
const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element: HTMLElement) => (isFontSize(element.style.fontSize) ? element.style.fontSize : null),
            renderHTML: (attrs: { fontSize?: string | null }) =>
              attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
          },
        },
      },
    ];
  },
});

/** Attributes kept on the node and written by someone else (here: the page wrapper). */
const pageAttr = { default: null, parseHTML: () => null, renderHTML: () => ({}) };

/**
 * The document, with the page background as its own attributes: the colour behind
 * all the text (and the text colour that reads on it). Kept outside the content, so
 * it covers every line, also one typed at the end, and changes in one undo step.
 * The HTML gets it as an outer <div> (joinPage), not from the schema.
 */
const PageDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: 'block+',
  addAttributes() {
    return { backgroundColor: pageAttr, color: pageAttr };
  },
});

/** The schema's extensions, configured as the editor uses them. */
export function schemaExtensions() {
  return [
    StarterKit.configure({
      // PageDocument instead: the same document, with the page background.
      document: false,
      heading: { levels: [...HEADINGS] },
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
        // Only links the stored HTML keeps (web, mail, phone): no ftp:, sms:, … that the
        // sanitiser would strip on save. Scheme-less passes: autolink checks the typed
        // text ("www.mobi.uz") before it adds https://.
        isAllowedUri: (url, ctx) =>
          ctx.defaultValidate(url) &&
          (LINK_PROTOCOL.test(url.trim()) || !/^[a-z][a-z0-9+.-]*:/i.test(url.trim())),
        // Target and rel come from the link popup's checkbox.
        HTMLAttributes: { target: null, rel: null },
      },
    }),
    PageDocument,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ListStyle,
    ColoredText,
    Color,
    BackgroundColor,
    FontSize,
    ColorBox,
    ...tableExtensions,
  ];
}
