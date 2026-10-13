import { createDocument, getHTMLFromFragment, getSchema } from '@tiptap/react';
import type { Schema } from '@tiptap/pm/model';
import {
  fromEditorHtml,
  joinPage,
  sanitizeHtml,
  splitPage,
  stripTableDefaults,
  toEditorHtml,
} from '../../lib/rich-html';
import { schemaExtensions } from './schema';

/**
 * HTML in the form the editor gives it back, without showing an editor: what
 * saving from the HTML tab stores, so it is what the "Text" view would have made of
 * it. Otherwise text written in the HTML tab (bare text, a plain <div>) is rewritten
 * the next time someone opens that language in the "Text" view, which then counts as
 * a change nobody made. The same steps as the editor's load (tiptap-editor.tsx):
 * page background off, table defaults off, line breaks into the editor's terms,
 * parsed by the schema, and back. Loaded on its own (dynamic import) when saving.
 */
let schema: Schema | null = null;

export function toEditorForm(html: string): string {
  if (!html || typeof document === 'undefined') return html;
  schema ??= getSchema(schemaExtensions());
  const { page, body } = splitPage(sanitizeHtml(html));
  const doc = createDocument(toEditorHtml(stripTableDefaults(body)), schema);
  const first = doc.firstChild;
  const empty = doc.childCount === 1 && Boolean(first?.isTextblock) && first!.content.size === 0;
  // As editorHtml: no text and no page is nothing; a page keeps an empty line.
  if (empty && !page) return '';
  return joinPage(fromEditorHtml(getHTMLFromFragment(doc.content, schema)), page);
}
