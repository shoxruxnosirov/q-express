/**
 * Regressions from the third review: each test pins a bug that was found and fixed,
 * so it cannot come back unnoticed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { act, fireEvent } from '@testing-library/react';
import { mount, roundTrip, saved, settle } from './editor-test-utils';
import {
  changedHtml,
  fromEditorHtml,
  htmlEquals,
  normalizeHtml,
  preparePastedHtml,
  sanitizeHtml,
  toEditorHtml,
} from '../../lib/rich-html';

describe('stored HTML', () => {
  it('keeps a numbered list starting at 3, and notices a change of start', async () => {
    const m = await mount('<ol start="3"><li><p>third</p></li></ol>');
    expect(await roundTrip(m.editor)).toBe('<ol start="3"><li><p>third</p></li></ol>');
    expect(htmlEquals('<ol start="3"><li>a</li></ol>', '<ol><li>a</li></ol>')).toBe(false);
    expect(sanitizeHtml('<p start="3">a</p><ol start="x"><li>a</li></ol>')).toBe(
      '<p>a</p><ol><li>a</li></ol>',
    );
  });

  it('a space removed or added next to formatting is a change', () => {
    expect(
      htmlEquals('<p><strong>Narx:</strong> 100</p>', '<p><strong>Narx:</strong>100</p>'),
    ).toBe(false);
    expect(htmlEquals('<p>a <strong>b</strong></p>', '<p>a<strong>b</strong></p>')).toBe(false);
    // Whitespace a browser never shows is still not a change.
    expect(htmlEquals('<p>a</p>\n  <p>b</p>', '<p>a</p><p>b</p>')).toBe(true);
    expect(htmlEquals('<p> a  b </p>', '<p>a b</p>')).toBe(true);
  });

  it('a style property named constructor or __proto__ is dropped, not a crash', () => {
    expect(sanitizeHtml('<p><span style="constructor: x; color: red">a</span></p>')).toBe(
      '<p><span style="color: red;">a</span></p>',
    );
    expect(sanitizeHtml('<p style="__proto__: x">a</p>')).toBe('<p>a</p>');
    expect(() => htmlEquals('<p style="constructor: x">a</p>', '<p>a</p>')).not.toThrow();
  });

  it('equal content written differently is equal (no false notice, no false dirty)', () => {
    expect(
      htmlEquals('<p style="text-align: center">x</p>', '<p style="text-align: center;">x</p>'),
    ).toBe(true);
    expect(
      htmlEquals('<p><em><strong>x</strong></em></p>', '<p><strong><em>x</em></strong></p>'),
    ).toBe(true);
    expect(
      htmlEquals(
        '<table><tbody><tr><td>a</td></tr></tbody></table>',
        '<table><colgroup><col></colgroup><tbody><tr><td>a</td></tr></tbody></table>',
      ),
    ).toBe(true);
  });

  it('text colours that cannot be read are refused; readable ones stay', () => {
    for (const c of [
      'rgb(0,0,0,0)',
      'rgb(255,255,255,0%)',
      'rgba(0,0,0,.001)',
      '#00000001',
      'canvas',
    ]) {
      expect(sanitizeHtml(`<p><span style="color: ${c}">a</span></p>`)).toBe('<p>a</p>');
    }
    for (const c of ['rgba(0, 0, 0, 0.6)', '#1155CC', 'red', 'rgb(204, 0, 0)']) {
      expect(sanitizeHtml(`<p><span style="color: ${c}">a</span></p>`)).toContain('color');
    }
  });

  it('rel keeps only link words', () => {
    expect(sanitizeHtml('<a href="https://a.uz" rel="opener evil nofollow">x</a>')).toBe(
      '<a href="https://a.uz" rel="nofollow">x</a>',
    );
    expect(sanitizeHtml('<a href="https://a.uz" rel="opener">x</a>')).toBe(
      '<a href="https://a.uz">x</a>',
    );
  });

  it("Excel's <col span> becomes one column each", () => {
    const out = preparePastedHtml(
      '<table><colgroup><col span="3" width="64"></colgroup><tbody><tr><td>a</td></tr></tbody></table>',
    );
    expect(out.match(/<col /g)).toHaveLength(3);
    expect(out).not.toContain('span=');
  });

  it('many trailing empty paragraphs are trimmed in linear time', () => {
    const start = performance.now();
    expect(normalizeHtml(`<p>x</p>${'<p></p>'.repeat(20000)}`)).toBe('<p>x</p>');
    expect(performance.now() - start).toBeLessThan(5000);
  });
});

describe('line breaks: the editor shows what the read view and the app show', () => {
  it.each([
    // editor HTML → stored (browser) HTML
    ['<p>a</p><p></p><p>b</p>', '<p>a</p><p><br></p><p>b</p>'],
    ['<p>a<br></p>', '<p>a<br><br></p>'],
    ['<p>a<br>b</p>', '<p>a<br>b</p>'],
  ])('%s is stored as %s and loads back unchanged', (editor, stored) => {
    expect(fromEditorHtml(editor)).toBe(stored);
    expect(toEditorHtml(stored)).toBe(editor);
  });

  it('an empty line in the middle survives save and reload', async () => {
    const m = await mount('<p>a</p><p><br></p><p>b</p>');
    expect(m.editor.getHTML()).toBe('<p>a</p><p></p><p>b</p>');
    expect(await roundTrip(m.editor)).toBe('<p>a</p><p><br></p><p>b</p>');
  });

  it('a final <br> after text shows nothing in a browser, so it is not a change', () => {
    expect(htmlEquals('<p>a<br></p>', '<p>a</p>')).toBe(true);
    // An empty line is something, though.
    expect(htmlEquals('<p>a</p><p><br><br></p><p>b</p>', '<p>a</p><p><br></p><p>b</p>')).toBe(
      false,
    );
  });
});

describe('editor behaviour', () => {
  it('editing a link from its bubble after clicking inside it again keeps one link', async () => {
    const m = await mount('<p><a href="https://x.uz">here</a></p>');
    const link = () => m.q('.ProseMirror a')!;
    await m.run(() => {
      m.editor.commands.setTextSelection(3);
      fireEvent.mouseUp(link());
    });
    await m.click('Havolani tahrirlash');
    // Click inside the same link again: the caret collapses, the form stays open.
    await m.run(() => {
      m.editor.commands.setTextSelection(4);
      fireEvent.mouseUp(link());
    });
    const url = m.q<HTMLInputElement>('.rich-editor__form input[type=url]')!;
    await m.run(() => fireEvent.change(url, { target: { value: 'https://y.uz' } }));
    await m.run(() => fireEvent.submit(url.form!));
    expect(saved(m.editor)).toBe('<p><a href="https://y.uz">here</a></p>');
  });

  it('one undo after a column drag brings the auto widths back', async () => {
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      return { width: /^(TD|TH)$/.test(this.tagName) ? 150 : 0 } as DOMRect;
    };
    const m = await mount('<table><tr><td><p>a</p></td><td><p>b</p></td></tr></table>');
    await act(async () => {
      const pos = m.cells()[0];
      const tr = m.editor.state.tr.setNodeMarkup(pos, null, {
        ...m.editor.state.doc.nodeAt(pos)!.attrs,
        colwidth: [300],
      });
      m.editor.view.dispatch(tr);
    });
    await settle();
    expect(m.editor.getHTML()).toContain('colwidth="150"');
    await act(async () => {
      m.editor.commands.undo();
    });
    await settle();
    expect(m.editor.getHTML()).not.toContain('colwidth');
    Element.prototype.getBoundingClientRect = original;
  });

  it('arrows inside a cell-popup dropdown move once, within the dropdown', async () => {
    const m = await mount('<table><tr><td><p>a</p></td></tr></table>');
    await m.cellPopup(m.cells()[0] + 2);
    await m.click('Yacheyka rangi');
    const swatches = () =>
      Array.from(m.container.querySelectorAll<HTMLElement>('.rich-editor__swatch'));
    expect(document.activeElement).toBe(swatches()[0]);
    await m.run(() => fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' }));
    expect(document.activeElement).toBe(swatches()[1]);

    await m.run(() => fireEvent.keyDown(document.activeElement!, { key: 'Escape' }));
    await m.click('Vertikal tekislash');
    await m.run(() => fireEvent.keyDown(document.activeElement!, { key: 'Home' }));
    expect(document.activeElement?.getAttribute('role')).toBe('menuitemradio');
    expect(m.q('[role=menu]')).not.toBeNull();
  });

  it('a cell-popup dropdown that would open over the toolbar opens downwards', async () => {
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (this.classList.contains('rich-editor__toolbar')) return new DOMRect(0, 60, 600, 40);
      if (this.classList.contains('rich-editor__popup')) return new DOMRect(0, 90, 180, 120);
      return original.call(this);
    };
    const m = await mount('<table><tr><td><p>a</p></td></tr></table>');
    await m.cellPopup(m.cells()[0] + 2);
    await m.click('Vertikal tekislash');
    expect(m.q('.rich-editor__popup')?.getAttribute('data-side')).toBe('bottom');
    Element.prototype.getBoundingClientRect = original;
  });

  it('Tab out of a toolbar popup closes it; the colour picker taking focus does not', async () => {
    const m = await mount('<table><tr><td><p>a</p></td></tr></table>');
    await m.select(2);
    await m.click('Abzats formati');
    const item = m.q('[role=menu] button')!;
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    await m.run(() => fireEvent.blur(item, { relatedTarget: outside }));
    expect(m.q('[role=menu]')).toBeNull();
    outside.remove();

    await m.cellPopup(m.cells()[0] + 2);
    await m.click('Yacheyka rangi');
    const input = m.q('.rich-editor__custom-color input')!;
    // The browser's picker opening: focus leaves the page, no new target.
    await m.run(() => fireEvent.blur(input, { relatedTarget: null }));
    expect(m.q('.rich-editor__colors')).not.toBeNull();
  });

  it('the toolbar is one Tab stop; popups say what they open', async () => {
    const m = await mount('<p>a</p>');
    const buttons = Array.from(
      m.container.querySelectorAll<HTMLButtonElement>('.rich-editor__toolbar button'),
    );
    expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    expect(m.button('Havola').getAttribute('aria-haspopup')).toBe('dialog');
    expect(m.button('Jadval').getAttribute('aria-haspopup')).toBe('grid');
    expect(m.button('Abzats formati').getAttribute('aria-haspopup')).toBe('menu');
  });
});

describe('regression check of the third-review fixes', () => {
  it("pasting the editor's own copy is not converted twice", async () => {
    // ProseMirror itself drops one final <br> of a pasted slice (plain Tiptap does the
    // same); converting its own copy as well would drop a second one.
    const m = await mount('<p>xy</p>');
    await m.select(2);
    await m.run(() => m.editor.view.pasteHTML('<p data-pm-slice="1 1 []">a<br><br></p>'));
    expect(m.editor.getHTML()).toBe('<p>xa<br>y</p>');
  });

  it('non-breaking spaces are content; a line of them is an empty line', () => {
    expect(htmlEquals('<p>a&nbsp;&nbsp;&nbsp;b</p>', '<p>a b</p>')).toBe(false);
    expect(htmlEquals('<p>x</p><p>&nbsp;</p><p>y</p>', '<p>x</p><p><br></p><p>y</p>')).toBe(true);
  });

  it('whitespace collapses across inline formatting, as a browser shows it', () => {
    expect(htmlEquals('<p><strong>\n  Hi</strong></p>', '<p><strong>Hi</strong></p>')).toBe(true);
    expect(htmlEquals('<p>a <code> b</code></p>', '<p>a <code>b</code></p>')).toBe(true);
    // …but a space between words is still a change.
    expect(htmlEquals('<p>a<code>b</code></p>', '<p>a <code>b</code></p>')).toBe(false);
  });

  it('a line break at the end of bold text counts like one at the end of the paragraph', () => {
    expect(fromEditorHtml('<p>x<strong>a<br></strong></p>')).toBe(
      '<p>x<strong>a<br><br></strong></p>',
    );
    expect(toEditorHtml('<p>x<strong>a<br><br></strong></p>')).toBe(
      '<p>x<strong>a<br></strong></p>',
    );
    expect(htmlEquals('<p>x<strong>a<br></strong></p>', '<p>x<strong>a</strong></p>')).toBe(true);
  });
});

describe('fourth review fixes', () => {
  it('1: leaving the link form for another field keeps focus on that field', async () => {
    const m = await mount('<p>abc</p>');
    await m.selectAll();
    await m.click('Havola');
    const url = m.q<HTMLInputElement>('.rich-editor__form input[type=url]')!;
    const other = document.createElement('input');
    document.body.appendChild(other);
    await m.run(() => {
      fireEvent.blur(url, { relatedTarget: other });
      other.focus();
    });
    await settle();
    expect(m.q('.rich-editor__form')).toBeNull();
    expect(document.activeElement).toBe(other);
    other.remove();
  });

  it('18: closing a menu with its own button gives focus back to the text', async () => {
    const m = await mount('<p>abc</p>');
    await m.select(2);
    await m.click('Abzats formati');
    expect(document.activeElement?.getAttribute('role')).toBe('menuitemradio');
    await m.click('Abzats formati');
    await settle();
    expect(m.q('[role=menu]')).toBeNull();
    expect(document.activeElement).toBe(m.editor.view.dom);
  });

  it('2: a table padded out by huge spans loses its merges; a big real table stays', () => {
    const amplified =
      '<table><tbody><tr>' +
      '<td colspan="50">a</td>'.repeat(5) +
      '</tr>' +
      '<tr><td>b</td></tr>'.repeat(10) +
      '</tbody></table>';
    expect(sanitizeHtml(amplified)).not.toContain('colspan');
    const ragged =
      '<table><tbody><tr>' +
      '<td>x</td>'.repeat(60) +
      '</tr>' +
      '<tr><td>y</td></tr>'.repeat(100) +
      '</tbody></table>';
    expect(sanitizeHtml(ragged)).not.toContain('<table');
    const real =
      '<table><tbody>' + `<tr>${'<td>c</td>'.repeat(30)}</tr>`.repeat(100) + '</tbody></table>';
    expect(sanitizeHtml(real)).toBe(real);
  });

  it('11: a cell cannot carry its own width; table and column widths stay', () => {
    const out = sanitizeHtml(
      '<table style="width: 100%"><colgroup><col style="width: 50%"></colgroup><tbody><tr><td style="min-width: 5000px; width: 900px; padding: 0.4em">a</td></tr></tbody></table>',
    );
    expect(out).toContain('<table style="width: 100%">');
    expect(out).toContain('<col style="width: 50%">');
    expect(out).toContain('<td style="padding: 0.4em;">');
  });

  it('13: a code block starting with a blank line keeps it through every save', () => {
    const once = normalizeHtml('<pre>\n\n<code>x</code></pre>');
    expect(once).toBe('<pre>\n\n<code>x</code></pre>');
    expect(normalizeHtml(once)).toBe(once);
    expect(normalizeHtml(normalizeHtml(once))).toBe(once);
  });

  it('4: attribute order, colour notation and empty formatting are not changes', () => {
    expect(
      htmlEquals(
        '<p><a href="https://a.uz" target="_blank" rel="noopener noreferrer">x</a></p>',
        '<p><a target="_blank" rel="noopener noreferrer" href="https://a.uz">x</a></p>',
      ),
    ).toBe(true);
    expect(
      htmlEquals(
        '<table><tbody><tr><td style="background-color: #ff0000">a</td></tr></tbody></table>',
        '<table><tbody><tr><td style="background-color: rgb(255, 0, 0)">a</td></tr></tbody></table>',
      ),
    ).toBe(true);
    expect(htmlEquals('<h4><strong>  </strong>x</h4>', '<h4>x</h4>')).toBe(true);
    // A real change is still one.
    expect(
      htmlEquals('<p><a href="https://a.uz">x</a></p>', '<p><a href="https://b.uz">x</a></p>'),
    ).toBe(false);
  });

  it('5: Alt+F10 focuses the cell popup again after a command', async () => {
    const m = await mount('<table><tr><td><p>a</p></td></tr></table>');
    await m.cellPopup(m.cells()[0] + 2);
    await settle();
    await m.click('Sarlavha qatori');
    await settle();
    expect(m.q('.rich-editor__cell-bubble')?.contains(document.activeElement)).toBe(false);
    await m.cellPopup(m.cells()[0] + 2);
    await settle();
    expect(m.q('.rich-editor__cell-bubble')?.contains(document.activeElement)).toBe(true);
  });

  it('3: only the edited languages are sent, measured against the loaded copy', () => {
    const loaded = { uz: '<p>uz</p>', ru: '<p>ru</p>', en: '<p>en</p>' };
    const form = { uz: '<p>uz changed</p>', ru: '<p>ru</p>', en: '' };
    expect(changedHtml(form, loaded, ['uz', 'ru', 'en', 'kaa'] as const)).toEqual({
      uz: '<p>uz changed</p>',
      en: '',
    });
  });

  it('7: a Google Docs blank line pastes as one empty line', async () => {
    const m = await mount();
    await m.run(() =>
      m.editor.view.pasteHTML(
        '<b style="font-weight:normal;" id="docs-internal-guid-1"><p>one</p><br><p>two</p></b>',
      ),
    );
    expect(m.editor.getHTML()).toBe('<p>one</p><p></p><p>two</p>');
    expect(saved(m.editor)).toBe('<p>one</p><p><br></p><p>two</p>');
  });

  it('8: list styles on items or in `type` are kept', async () => {
    const m = await mount(
      '<ol><li style="list-style-type: lower-roman"><p>a</p></li></ol><ol type="a"><li><p>b</p></li></ol>',
    );
    const out = saved(m.editor);
    expect(out).toContain('<ol style="list-style-type: lower-roman;">');
    expect(out).toContain('<ol style="list-style-type: lower-alpha;">');
  });

  it('6: a popup near the edge of a narrow screen is moved back onto it', async () => {
    const original = Element.prototype.getBoundingClientRect;
    const width = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
    Element.prototype.getBoundingClientRect = function () {
      return this.classList.contains('rich-editor__popup')
        ? new DOMRect(200, 300, 300, 200)
        : original.call(this);
    };
    const m = await mount('<p>a</p>');
    await m.select(2);
    await m.click('Havola');
    // 200 + 300 runs past 360 − 8 by 148: moved left by that.
    expect(m.q<HTMLElement>('.rich-editor__popup')?.style.left).toBe('-148px');
    Element.prototype.getBoundingClientRect = original;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  });
});

describe('fifth review fixes', () => {
  it('14: action menus are plain menu items; choice menus stay radio items', async () => {
    const m = await mount('<table><tr><td><p>a</p></td></tr></table>');
    await m.cellPopup(m.cells()[0] + 2);
    await m.click("Qator qo'shish");
    const items = Array.from(m.container.querySelectorAll('[role=menu] button'));
    expect(items.map((b) => b.getAttribute('role'))).toEqual(['menuitem', 'menuitem']);
    expect(items.some((b) => b.hasAttribute('aria-checked'))).toBe(false);

    await m.run(() => fireEvent.keyDown(document.activeElement!, { key: 'Escape' }));
    await m.click('Vertikal tekislash');
    const choices = Array.from(m.container.querySelectorAll('[role=menu] button'));
    expect(choices.every((b) => b.getAttribute('role') === 'menuitemradio')).toBe(true);
    expect(choices.every((b) => b.hasAttribute('aria-checked'))).toBe(true);
  });

  it('16: special characters are announced by name, in every language', async () => {
    const m = await mount('<p>a</p>');
    await m.select(2);
    await m.click('Maxsus belgilar');
    const labels = Array.from(m.container.querySelectorAll('.rich-editor__symbol')).map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(labels).toHaveLength(20);
    expect(labels[0]).toBe('oʻ va gʻ uchun belgi');
    expect(labels.every((l) => l && !/U\+|undefined/.test(l))).toBe(true);

    const source = readFileSync(join(__dirname, '../../i18n/messages/richText.ts'), 'utf8');
    const keys = readFileSync(join(__dirname, 'editor-chrome.tsx'), 'utf8').match(
      /key: '(sym\w+)'/g,
    )!;
    expect(keys).toHaveLength(20);
    for (const k of keys) {
      const name = k.slice(6, -1);
      // Once each in uz, ru and en; single or double quotes (a uz name with an
      // apostrophe is in double quotes).
      expect(source.match(new RegExp(`^ {4}${name}: (?:'[^']+'|"[^"]+"),$`, 'gm'))).toHaveLength(3);
    }
  });
});

describe('text colour', () => {
  type M = Awaited<ReturnType<typeof mount>>;
  const swatch = (m: M, c: string) => m.q(`.rich-editor__swatch[aria-label="${c}"]`)!;
  const tab = (m: M, name: string) =>
    Array.from(m.container.querySelectorAll('[role=tab]')).find((b) => b.textContent === name)!;
  const noColour = (m: M) =>
    Array.from(m.container.querySelectorAll('.rich-editor__color-actions button')).find(
      (b) => b.textContent === 'Rangsiz',
    )!;
  // `color:` on its own, not the end of `background-color:`.
  const textColour = (html: string) => /(?:^|[^-])color: ([^;"]+)/.exec(html)?.[1] ?? null;

  it('colours the selected text and keeps it through save and reload', async () => {
    const m = await mount('<p>abc</p>');
    await m.select(1, 4);
    await m.click('Matn rangi');
    expect(m.q('[role=dialog]')?.getAttribute('aria-label')).toBe('Matn rangi');
    await m.run(() => fireEvent.click(swatch(m, '#CC0000')));
    expect(saved(m.editor)).toMatch(
      /^<p><span style="color: (#CC0000|rgb\(204, 0, 0\));?">abc<\/span><\/p>$/i,
    );
    expect(await roundTrip(m.editor)).toMatch(/<span style="color: [^"]+">abc<\/span>/);
    expect(m.isOn('Matn rangi')).toBe(true);
  });

  it('a colour that would not show on white cannot be picked, by swatch or custom colour', async () => {
    const m = await mount('<p>abc</p>');
    await m.select(1, 4);
    await m.click('Matn rangi');
    expect(swatch(m, '#FFFF00').getAttribute('aria-disabled')).toBe('true');
    expect(swatch(m, '#CC0000').hasAttribute('aria-disabled')).toBe(false);
    await m.run(() => fireEvent.click(swatch(m, '#FFFF00')));
    await m.run(() =>
      fireEvent.change(m.q<HTMLInputElement>('.rich-editor__custom-color input')!, {
        target: { value: '#ffffff' },
      }),
    );
    expect(saved(m.editor)).toBe('<p>abc</p>');
    const hint = m.q('.rich-editor__colors [role=status]');
    expect(hint?.textContent).toBe("Bu fonda ko'rinmaydigan ranglarni tanlab bo'lmaydi.");
    expect(hint?.hasAttribute('data-error')).toBe(true);
  });

  it('a dark highlight turns the letters white; removing it takes the white away', async () => {
    const m = await mount('<p>abc</p>');
    await m.select(1, 4);
    await m.click('Matn rangi');
    await m.run(() => fireEvent.click(tab(m, 'Fon')));
    // Any highlight can be picked: the letters change to go with it.
    expect(m.q('.rich-editor__swatch[aria-disabled]')).toBeNull();
    await m.run(() => fireEvent.click(swatch(m, '#000000')));
    const out = saved(m.editor);
    expect(out).toMatch(/background-color: (#000000|rgb\(0, 0, 0\))/);
    expect(textColour(out)).toMatch(/^(#FFFFFF|rgb\(255, 255, 255\))$/i);

    await m.select(1, 4);
    await m.click('Matn rangi');
    await m.run(() => fireEvent.click(tab(m, 'Fon')));
    await m.run(() => fireEvent.click(noColour(m)));
    expect(saved(m.editor)).toBe('<p>abc</p>');
  });

  it('in a dark cell, white letters can be picked and black cannot', async () => {
    const m = await mount(
      '<table><tbody><tr><td style="background-color: #000000; color: #FFFFFF"><p>abc</p></td></tr></tbody></table>',
    );
    const at = m.cells()[0];
    await m.select(at + 2, at + 5);
    await m.click('Matn rangi');
    expect(swatch(m, '#000000').getAttribute('aria-disabled')).toBe('true');
    expect(swatch(m, '#FFFFFF').hasAttribute('aria-disabled')).toBe(false);
  });

  it('a dark cell background turns its text white; the cell picker blocks unreadable text', async () => {
    const m = await mount('<table><tbody><tr><td><p>a</p></td></tr></tbody></table>');
    await m.cellPopup(m.cells()[0] + 2);
    await m.click('Yacheyka rangi');
    await m.run(() => fireEvent.click(swatch(m, '#000000')));
    expect(textColour(saved(m.editor))).toMatch(/^(#FFFFFF|rgb\(255, 255, 255\))$/i);
    await m.click('Yacheyka rangi');
    await m.run(() => fireEvent.click(tab(m, 'Matn')));
    expect(swatch(m, '#000000').getAttribute('aria-disabled')).toBe('true');
  });

  it('clearing formatting removes text colours', async () => {
    const m = await mount('<p>abc</p>');
    await m.select(1, 4);
    await m.click('Matn rangi');
    await m.run(() => fireEvent.click(swatch(m, '#CC0000')));
    await m.select(1, 4);
    await m.click('Formatni tozalash');
    expect(saved(m.editor)).toBe('<p>abc</p>');
  });

  it('a paste from a dark page or Google Docs brings no text colours or bare spans; cells keep theirs', async () => {
    const m = await mount('');
    await m.run(() =>
      m.editor.view.pasteHTML(
        '<p><span style="color:#f3f4f6">dark</span> <span style="color:#000000;background-color:transparent;font-weight:700">docs</span></p><table><tr><td style="background-color:#fff2cc">a</td></tr></table>',
      ),
    );
    const out = await roundTrip(m.editor);
    expect(out).not.toContain('<span');
    expect(out).toContain('<strong>docs</strong>');
    expect(out).toMatch(/background-color: (#fff2cc|rgb\(255, 242, 204\))/i);
  });

  it('the editor’s own copy keeps its colours when pasted back', async () => {
    const m = await mount('<p>x</p>');
    await m.select(2);
    await m.run(() =>
      m.editor.view.pasteHTML(
        '<p data-pm-slice="1 1 []"><span style="color: #CC0000">red</span></p>',
      ),
    );
    expect(saved(m.editor)).toMatch(
      /^<p>x<span style="color: (#CC0000|rgb\(204, 0, 0\));?">red<\/span><\/p>$/i,
    );
  });
});

describe('colour changes keep every word readable', () => {
  type M = Awaited<ReturnType<typeof mount>>;
  const swatch = (m: M, c: string) => m.q(`.rich-editor__swatch[aria-label="${c}"]`)!;
  const tab = (m: M, name: string) =>
    Array.from(m.container.querySelectorAll('[role=tab]')).find((b) => b.textContent === name)!;
  // Colours as #RRGGBB: the editor writes some back as rgb(), the same colour.
  const hex = (html: string) =>
    html.replace(
      /rgb\((\d+), (\d+), (\d+)\)/g,
      (_, ...rgb: string[]) =>
        `#${rgb
          .slice(0, 3)
          .map((n) => Number(n).toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase()}`,
    );

  it('a dark cell background: the cell turns white and a red word in it gives up its red', async () => {
    const m = await mount(
      '<table><tbody><tr><td><p><span style="color: #CC0000">red</span> x</p></td></tr></tbody></table>',
    );
    await m.cellPopup(m.cells()[0] + 2);
    await m.click('Yacheyka rangi');
    await m.run(() => fireEvent.click(swatch(m, '#990000')));
    const out = hex(saved(m.editor));
    expect(out).toMatch(/<td style="[^"]*background-color: #990000; color: #FFFFFF;">/);
    expect(out).not.toContain('<span');
    // One undo brings back the cell and the red word together.
    await m.run(() => m.editor.commands.undo());
    expect(hex(saved(m.editor))).toContain('<span style="color: #CC0000;">red</span>');
    expect(hex(saved(m.editor))).not.toContain('#990000');
  });

  it('several selected cells are each made readable on their own', async () => {
    const m = await mount(
      '<table><tbody><tr><td><p>a</p></td><td style="background-color: #000000; color: #FFFFFF"><p>b</p></td></tr></tbody></table>',
    );
    const [a, b] = m.cells();
    await m.run(() => m.editor.commands.setCellSelection({ anchorCell: a, headCell: b }));
    await m.run(() => fireEvent.keyDown(m.editor.view.dom, { key: 'F10', altKey: true }));
    await m.click('Yacheyka rangi');
    await m.run(() => fireEvent.click(swatch(m, '#FFF2CC')));
    const cells = hex(saved(m.editor)).match(/<td[^>]*>/g)!;
    // Both light now; the white text of the second would vanish, so it goes.
    expect(cells).toHaveLength(2);
    for (const cell of cells) {
      expect(cell).toContain('background-color: #FFF2CC;');
      expect(cell).not.toContain('#FFFFFF');
    }
  });

  it('a dark highlight over mixed words: plain ones turn white, a readable blue stays', async () => {
    const m = await mount('<p>plain <span style="color: #1155CC">blue</span></p>');
    await m.select(1, 11);
    await m.click('Matn rangi');
    await m.run(() => fireEvent.click(tab(m, 'Fon')));
    await m.run(() => fireEvent.click(swatch(m, '#000000')));
    const out = hex(saved(m.editor));
    expect(out).toContain('<span style="color: #FFFFFF; background-color: #000000;">plain </span>');
    expect(out).toContain('<span style="color: #1155CC; background-color: #000000;">blue</span>');
  });
});

describe('coloured box', () => {
  type M = Awaited<ReturnType<typeof mount>>;
  const swatch = (m: M, c: string) => m.q(`.rich-editor__swatch[aria-label="${c}"]`)!;
  const tab = (m: M, name: string) =>
    Array.from(m.container.querySelectorAll('[role=tab]')).find((b) => b.textContent === name)!;
  const textButton = (m: M, text: string) =>
    Array.from(m.container.querySelectorAll('button')).find((b) => b.textContent === text)!;
  const hex = (html: string) =>
    html.replace(
      /rgb\((\d+), (\d+), (\d+)\)/g,
      (_, ...rgb: string[]) =>
        `#${rgb
          .slice(0, 3)
          .map((n) => Number(n).toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase()}`,
    );
  const BOX = (style: string, inner: string) =>
    `<div style="padding: 0.6em 0.8em; border-radius: 4px; ${style}">${inner}</div>`;

  it('puts the selected paragraphs in a box, which saves and reloads as it is', async () => {
    const m = await mount('<p>a</p><p>b</p><p>c</p>');
    await m.select(1, 5);
    await m.click('Rangli blok');
    expect(m.q('[role=dialog]')?.getAttribute('aria-label')).toBe('Rangli blok');
    await m.run(() => fireEvent.click(swatch(m, '#FFF2CC')));
    const out = hex(saved(m.editor));
    expect(out).toBe(
      BOX('background-color: #FFF2CC; border: 1px solid #DADADA;', '<p>a</p><p>b</p>') + '<p>c</p>',
    );
    expect(hex(await roundTrip(m.editor))).toBe(out);
    // The selection stays in the new box, so its button shows on; out of it, off.
    expect(m.isOn('Rangli blok')).toBe(true);
    await m.select(9); // in "c", after the box
    expect(m.isOn('Rangli blok')).toBe(false);
  });

  it('a dark background turns the box text white; black text cannot be picked in it', async () => {
    const m = await mount('<p>a</p>');
    await m.select(1, 2);
    await m.click('Rangli blok');
    await m.run(() => fireEvent.click(swatch(m, '#000000')));
    expect(hex(saved(m.editor))).toContain(
      'background-color: #000000; color: #FFFFFF; border: 1px solid #DADADA;',
    );
    await m.select(2);
    await m.click('Matn rangi');
    expect(swatch(m, '#000000').getAttribute('aria-disabled')).toBe('true');
  });

  it('a red word gives up its red when the box turns dark red', async () => {
    const m = await mount(
      BOX(
        'background-color: #FFF2CC; border: 1px solid #DADADA;',
        '<p><span style="color: #CC0000">red</span> x</p>',
      ),
    );
    await m.select(3);
    await m.click('Rangli blok');
    await m.run(() => fireEvent.click(swatch(m, '#990000')));
    const out = hex(saved(m.editor));
    expect(out).toContain('background-color: #990000; color: #FFFFFF;');
    expect(out).not.toContain('<span');
  });

  it('"Rangsiz" on background and border takes the box away; so does "Blokni olib tashlash"', async () => {
    const box = BOX('background-color: #FFF2CC; border: 1px solid #DADADA;', '<p>a</p>');
    const m = await mount(box);
    await m.select(3);
    await m.click('Rangli blok');
    await m.run(() => fireEvent.click(textButton(m, 'Rangsiz')));
    expect(hex(saved(m.editor))).toBe(BOX('border: 1px solid #DADADA;', '<p>a</p>'));
    await m.click('Rangli blok');
    await m.run(() => fireEvent.click(tab(m, 'Chegara')));
    await m.run(() => fireEvent.click(textButton(m, 'Rangsiz')));
    expect(saved(m.editor)).toBe('<p>a</p>');

    const n = await mount(box);
    await n.select(3);
    await n.click('Rangli blok');
    await n.run(() => fireEvent.click(textButton(n, 'Blokni olib tashlash')));
    expect(saved(n.editor)).toBe('<p>a</p>');
  });

  it('a list goes in the box whole; a box in a cell stays in the cell', async () => {
    const m = await mount('<ul><li><p>a</p></li><li><p>b</p></li></ul>');
    await m.select(3);
    await m.click('Rangli blok');
    await m.run(() => fireEvent.click(swatch(m, '#FFF2CC')));
    expect(hex(saved(m.editor))).toBe(
      BOX(
        'background-color: #FFF2CC; border: 1px solid #DADADA;',
        '<ul><li><p>a</p></li><li><p>b</p></li></ul>',
      ),
    );

    const t = await mount('<table><tbody><tr><td><p>a</p></td></tr></tbody></table>');
    await t.select(t.cells()[0] + 2);
    await t.click('Rangli blok');
    await t.run(() => fireEvent.click(swatch(t, '#FFF2CC')));
    expect(hex(saved(t.editor))).toMatch(
      /<td[^>]*><div style="[^"]*#FFF2CC[^"]*"><p>a<\/p><\/div><\/td>/,
    );
  });

  it('Enter on an empty last line leaves the box', async () => {
    const m = await mount(BOX('border: 1px solid #DADADA;', '<p>a</p>'));
    await m.select(3);
    await m.run(() => m.editor.commands.keyboardShortcut('Enter'));
    await m.run(() => m.editor.commands.keyboardShortcut('Enter'));
    await m.run(() => m.editor.commands.insertContent('b'));
    expect(hex(saved(m.editor))).toBe(BOX('border: 1px solid #DADADA;', '<p>a</p>') + '<p>b</p>');
  });

  it('a plain <div> is still read as paragraphs; a pasted bordered one (Word) is not a box', async () => {
    const m = await mount('<div>x</div><div>y</div>');
    expect(saved(m.editor)).toBe('<p>x</p><p>y</p>');
    const p = await mount('');
    await p.run(() =>
      p.editor.view.pasteHTML(
        '<div style="border:solid windowtext 1.0pt;padding:1pt;background:#ffff00"><p>w</p></div>',
      ),
    );
    expect(saved(p.editor)).toBe('<p>w</p>');
  });
});
