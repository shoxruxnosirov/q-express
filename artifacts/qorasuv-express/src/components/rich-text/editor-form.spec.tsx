/**
 * Saving reshapes HTML the way the editor would (editor-form.ts), without an editor:
 * the two must agree, or the "Text" view would still rewrite what was saved.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { settle } from './editor-test-utils';
import TiptapEditor from './tiptap-editor';
import { toEditorForm } from './editor-form';
import { htmlEquals, normalizeHtml } from '../../lib/rich-html';

const CASES = [
  'bare text',
  '<div>oddiy div</div><p>band</p>',
  '<h5>Sarlavha</h5><font color="red">qizil</font>',
  '<p>a<br>b</p><p><br></p><p>c</p>',
  '<ul><li>bir</li><li>ikki</li></ul><ol start="3" style="list-style-type: lower-roman"><li>uch</li></ol>',
  '<p><a href="https://mobi.uz" target="_blank">havola</a> va <strong>qalin</strong> <em>kursiv</em></p>',
  '<p><span style="color: #cc0000; background-color: #fff2cc">rangli</span></p>',
  '<table><tbody><tr><th>A</th><th>B</th></tr><tr><td style="background-color: #000000; color: #ffffff">1</td><td colspan="1">2</td></tr></tbody></table>',
  '<div style="padding: 0.6em 0.8em; border-radius: 4px; background-color: #FFF2CC; border: 1px solid #DADADA;"><p>blok</p></div>',
  '<div style="background-color: #000000; color: #FFFFFF; padding: 0.6em;"><p>fon</p><p>ikki</p></div>',
  '<pre><code>kod\n  satr</code></pre><blockquote><p>iqtibos</p></blockquote><hr>',
  '<h1 style="text-align: center">Markaz</h1><p style="text-align: justify">matn</p>',
  '',
];

async function editorLoads(value: string) {
  let loaded = '';
  const view = render(
    <TiptapEditor value={value} onChange={() => {}} onLoad={(h) => (loaded = h)} />,
  );
  await settle();
  view.unmount();
  return loaded;
}

describe('toEditorForm', () => {
  it.each(CASES)('stores what the editor would make of %j', async (html) => {
    const formed = normalizeHtml(toEditorForm(html));
    expect(formed).toBe(normalizeHtml(await editorLoads(html)));
    // Opening the stored form in the editor rewrites nothing.
    expect(htmlEquals(await editorLoads(formed), formed)).toBe(true);
    // And reshaping it again changes nothing.
    expect(normalizeHtml(toEditorForm(formed))).toBe(formed);
  });

  it('a page background with no text still keeps nothing to store', () => {
    expect(
      normalizeHtml(
        toEditorForm('<div style="background-color: #000; color: #fff;"><p></p></div>'),
      ),
    ).toBe('');
  });
});
