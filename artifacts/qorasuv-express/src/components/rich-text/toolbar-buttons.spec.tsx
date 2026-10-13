/**
 * Every toolbar and popup button, beyond the happy path: pressing twice, a bare
 * caret, several paragraphs, the "on" state the button shows, disabled states,
 * switching between kinds — and that the result still saves and reloads.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import { mount, roundTrip, saved, settle } from './editor-test-utils';

const TWO = '<p>one</p><p>two</p>';

describe('bold / italic / underline / strike', () => {
  const marks = [
    ['Qalin', 'strong'],
    ['Kursiv', 'em'],
    ['Tagiga chizilgan', 'u'],
    ['Ustiga chizilgan', 's'],
  ] as const;

  it.each(marks)('%s: second press takes it off again', async (label) => {
    const m = await mount('<p>abc</p>');
    await m.selectAll();
    await m.click(label);
    await m.click(label);
    expect(await roundTrip(m.editor)).toBe('<p>abc</p>');
  });

  it.each(marks)('%s: shows on only where the text has it', async (label, tag) => {
    const m = await mount(`<p><${tag}>in</${tag}> out</p>`);
    await m.select(2);
    expect(m.isOn(label)).toBe(true);
    await m.select(6);
    expect(m.isOn(label)).toBe(false);
  });

  it.each(marks)('%s: at a bare caret it applies to what is typed next', async (label, tag) => {
    const m = await mount('<p>a</p>');
    await m.select(2);
    await m.click(label);
    await m.run(() => m.editor.commands.insertContent('X'));
    await m.click(label);
    await m.run(() => m.editor.commands.insertContent('Y'));
    expect(await roundTrip(m.editor)).toBe(`<p>a<${tag}>X</${tag}>Y</p>`);
  });

  it.each(marks)(
    '%s: across two paragraphs, and over a partly formatted run',
    async (label, tag) => {
      const m = await mount(`<p>one</p><p>t<${tag}>w</${tag}>o</p>`);
      await m.selectAll();
      await m.click(label);
      expect(await roundTrip(m.editor)).toBe(
        `<p><${tag}>one</${tag}></p><p><${tag}>two</${tag}></p>`,
      );
    },
  );

  it.each([
    ['b', 66, 'strong'],
    ['i', 73, 'em'],
    ['u', 85, 'u'],
  ])('Ctrl+%s', async (key, keyCode, tag) => {
    const m = await mount('<p>abc</p>');
    await m.selectAll();
    await m.run(() =>
      fireEvent.keyDown(m.editor.view.dom, {
        key,
        code: `Key${key.toUpperCase()}`,
        keyCode,
        ctrlKey: true,
      }),
    );
    expect(saved(m.editor)).toBe(`<p><${tag}>abc</${tag}></p>`);
  });
});

describe('paragraph format', () => {
  it('shows the current format: button on, item checked', async () => {
    const m = await mount('<h3>a</h3><p>b</p>');
    await m.select(2);
    expect(m.isOn('Abzats formati')).toBe(true);
    await m.click('Abzats formati');
    const checked = m.q('[role=menu] [aria-checked="true"]');
    expect(checked?.textContent).toBe('Sarlavha 3');
    await m.run(() => fireEvent.keyDown(checked!, { key: 'Escape' }));
    await m.select(5);
    expect(m.isOn('Abzats formati')).toBe(false);
  });

  it('picking the current format again turns it back into a paragraph', async () => {
    const m = await mount('<h2>a</h2>');
    await m.select(2);
    await m.click('Abzats formati');
    await m.pick('Sarlavha 2');
    expect(saved(m.editor)).toBe('<p>a</p>');
  });

  it('heading → quote → code → paragraph', async () => {
    const m = await mount('<h2>a</h2>');
    const to = async (item: string) => {
      await m.select(2);
      await m.click('Abzats formati');
      await m.pick(item);
    };
    await to('Iqtibos');
    expect(saved(m.editor)).toBe('<blockquote><p>a</p></blockquote>');
    await to('Kod');
    expect(saved(m.editor)).toBe('<pre><code>a</code></pre>');
    await to('Oddiy matn');
    expect(await roundTrip(m.editor)).toBe('<p>a</p>');
  });

  it('applies to every selected paragraph', async () => {
    const m = await mount(TWO);
    await m.selectAll();
    await m.click('Abzats formati');
    await m.pick('Sarlavha 2');
    expect(await roundTrip(m.editor)).toBe('<h2>one</h2><h2>two</h2>');
  });

  it('inside a list item the item stays a list item', async () => {
    const m = await mount('<ul><li><p>a</p></li></ul>');
    await m.select(4);
    await m.click('Abzats formati');
    await m.pick('Sarlavha 2');
    const out = await roundTrip(m.editor);
    expect(out).toContain('a');
    expect(out).not.toContain('<p></p>');
  });
});

describe('lists', () => {
  it('bullet: on, shown on, off', async () => {
    const m = await mount('<p>a</p>');
    await m.select(2);
    await m.click("Belgili ro'yxat");
    expect(m.isOn("Belgili ro'yxat")).toBe(true);
    await m.click("Belgili ro'yxat");
    expect(await roundTrip(m.editor)).toBe('<p>a</p>');
  });

  it('two paragraphs become two items; bullet ↔ ordered switches the list', async () => {
    const m = await mount(TWO);
    await m.selectAll();
    await m.click("Belgili ro'yxat");
    expect(saved(m.editor)).toBe('<ul><li><p>one</p></li><li><p>two</p></li></ul>');
    await m.click("Raqamli ro'yxat");
    expect(await roundTrip(m.editor)).toBe('<ol><li><p>one</p></li><li><p>two</p></li></ol>');
    expect(m.isOn("Raqamli ro'yxat")).toBe(true);
    expect(m.isOn("Belgili ro'yxat")).toBe(false);
  });

  it('a style picked from the arrow is remembered by the button', async () => {
    const m = await mount(TWO);
    await m.select(2);
    const arrow = () =>
      m.container.querySelectorAll<HTMLElement>(`button[aria-label="Ro'yxat turi"]`)[0];
    await m.run(() => fireEvent.click(arrow()));
    await m.pick('Kvadrat');
    // The second paragraph (found by its text: the list moved it), with the plain
    // button: the remembered style.
    let two = -1;
    m.editor.state.doc.descendants((n, p) => {
      if (n.isText && n.text === 'two') two = p;
    });
    await m.select(two + 1);
    await m.click("Belgili ro'yxat");
    expect(saved(m.editor)).toBe(
      '<ul style="list-style-type: square;"><li><p>one</p></li><li><p>two</p></li></ul>',
    );
  });

  it('another style restyles; "Standart" drops the style; same style again removes the list', async () => {
    const m = await mount('<ul style="list-style-type: square;"><li><p>a</p></li></ul>');
    await m.select(4);
    const arrow = () =>
      m.container.querySelectorAll<HTMLElement>(`button[aria-label="Ro'yxat turi"]`)[0];
    await m.run(() => fireEvent.click(arrow()));
    await m.pick('Aylana');
    expect(saved(m.editor)).toBe('<ul style="list-style-type: circle;"><li><p>a</p></li></ul>');
    await m.run(() => fireEvent.click(arrow()));
    await m.pick('Standart');
    expect(saved(m.editor)).toBe('<ul><li><p>a</p></li></ul>');
    await m.run(() => fireEvent.click(arrow()));
    await m.pick('Standart');
    expect(await roundTrip(m.editor)).toBe('<p>a</p>');
  });

  it('Tab nests an item, Shift+Tab lifts it back', async () => {
    const m = await mount('<ul><li><p>a</p></li><li><p>b</p></li></ul>');
    await m.select(9);
    await m.run(() => fireEvent.keyDown(m.editor.view.dom, { key: 'Tab', keyCode: 9 }));
    expect(saved(m.editor)).toBe('<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>');
    await m.run(() =>
      fireEvent.keyDown(m.editor.view.dom, { key: 'Tab', keyCode: 9, shiftKey: true }),
    );
    expect(await roundTrip(m.editor)).toBe('<ul><li><p>a</p></li><li><p>b</p></li></ul>');
  });
});

describe('alignment', () => {
  it('icon / on state follows the text; left again removes the style', async () => {
    const m = await mount('<p>a</p>');
    await m.select(2);
    expect(m.isOn('Tekislash')).toBe(false);
    await m.click('Tekislash');
    await m.pick('Markazga');
    expect(m.isOn('Tekislash')).toBe(true);
    await m.click('Tekislash');
    await m.pick('Chapga');
    expect(m.isOn('Tekislash')).toBe(false);
    expect(await roundTrip(m.editor)).toMatch(/^<p( style="text-align: left;")?>a<\/p>$/);
  });

  it('several paragraphs, a heading and a list item', async () => {
    const m = await mount('<h2>h</h2><p>p</p><ul><li><p>l</p></li></ul>');
    await m.selectAll();
    await m.click('Tekislash');
    await m.pick("O'ngga");
    const out = await roundTrip(m.editor);
    expect(out.match(/text-align: right/g)).toHaveLength(3);
  });
});

describe('undo / redo', () => {
  it('disabled until there is something to undo or redo', async () => {
    const m = await mount('<p>a</p>');
    expect(m.isDisabled('Bekor qilish')).toBe(true);
    expect(m.isDisabled('Qaytarish')).toBe(true);
    await m.selectAll();
    await m.click('Qalin');
    expect(m.isDisabled('Bekor qilish')).toBe(false);
    expect(m.isDisabled('Qaytarish')).toBe(true);
    await m.click('Bekor qilish');
    expect(m.isDisabled('Qaytarish')).toBe(false);
    expect(saved(m.editor)).toBe('<p>a</p>');
  });
});

describe('link button and form', () => {
  const form = (m: Awaited<ReturnType<typeof mount>>) => ({
    url: m.q<HTMLInputElement>('.rich-editor__form input[type=url]')!,
    text: m.q<HTMLInputElement>('.rich-editor__form input:not([type])')!,
    submit: m.q<HTMLButtonElement>('.rich-editor__form button[type=submit]')!,
  });

  it('with nothing selected, inserts the address as the link text', async () => {
    const m = await mount('<p>a</p>');
    await m.select(2);
    await m.click('Havola');
    await m.run(() => fireEvent.change(form(m).url, { target: { value: 'https://mobi.uz' } }));
    await m.run(() => fireEvent.submit(form(m).url.form!));
    expect(await roundTrip(m.editor)).toBe('<p>a<a href="https://mobi.uz">https://mobi.uz</a></p>');
  });

  it('typed link text replaces the selection', async () => {
    const m = await mount('<p>abc</p>');
    await m.selectAll();
    await m.click('Havola');
    await m.run(() => {
      fireEvent.change(form(m).url, { target: { value: 'https://mobi.uz' } });
      fireEvent.change(form(m).text, { target: { value: 'Mobi' } });
    });
    await m.run(() => fireEvent.submit(form(m).url.form!));
    expect(await roundTrip(m.editor)).toBe('<p><a href="https://mobi.uz">Mobi</a></p>');
  });

  it('on an existing link: shown on, form says Update, Unlink works', async () => {
    const m = await mount('<p><a href="https://a.uz">abc</a></p>');
    await m.select(2);
    expect(m.isOn('Havola')).toBe(true);
    await m.click('Havola');
    expect(form(m).url.value).toBe('https://a.uz');
    expect(form(m).submit.textContent).toBe('Yangilash');
    const unlink = Array.from(m.container.querySelectorAll('.rich-editor__form button')).find(
      (b) => b.textContent === 'Havolani olib tashlash',
    )!;
    await m.run(() => fireEvent.click(unlink));
    expect(await roundTrip(m.editor)).toBe('<p>abc</p>');
  });

  it('empty address: an error, no change; Esc closes without a change', async () => {
    const m = await mount('<p>abc</p>');
    await m.selectAll();
    await m.click('Havola');
    await m.run(() => fireEvent.submit(form(m).url.form!));
    // The message area is a live region all along, so the error is announced.
    const message = m.q('.rich-editor__form [aria-live="assertive"]');
    expect(message?.textContent).toBe('Havola manzilini kiriting.');
    expect(message?.hasAttribute('data-error')).toBe(true);
    await m.run(() => fireEvent.change(form(m).url, { target: { value: 'https://x.uz' } }));
    await m.run(() => fireEvent.keyDown(form(m).url, { key: 'Escape' }));
    expect(m.q('.rich-editor__form')).toBeNull();
    expect(saved(m.editor)).toBe('<p>abc</p>');
  });

  it('link popup: Open goes to the address in a new tab, safely', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const m = await mount('<p><a href="https://a.uz">abc</a></p>');
    await m.run(() => {
      m.editor.commands.setTextSelection(2);
      fireEvent.mouseUp(m.q('.ProseMirror a')!);
    });
    await m.click('Havolani ochish');
    expect(open).toHaveBeenCalledWith('https://a.uz', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });
});

describe('special characters', () => {
  it('replaces the selection, closes, and arrows move through the grid', async () => {
    const m = await mount('<p>xab</p>');
    await m.select(2, 3);
    await m.click('Maxsus belgilar');
    const symbols = () =>
      Array.from(m.container.querySelectorAll<HTMLElement>('.rich-editor__symbol'));
    expect(document.activeElement).toBe(symbols()[0]);
    await m.run(() => fireEvent.keyDown(symbols()[0], { key: 'ArrowRight' }));
    expect(document.activeElement).toBe(symbols()[1]);
    await m.run(() => fireEvent.keyDown(symbols()[1], { key: 'ArrowDown' }));
    expect(document.activeElement).toBe(symbols()[6]);
    await m.run(() => fireEvent.click(document.activeElement!));
    expect(m.q('.rich-editor__symbol')).toBeNull();
    expect(await roundTrip(m.editor)).toBe('<p>x—b</p>');
  });
});

describe('table picker', () => {
  it('arrows size it, Enter inserts; Esc closes without inserting', async () => {
    const m = await mount('<p>a</p>');
    await m.select(2);
    await m.click('Jadval');
    const grid = m.q('.rich-editor__table-grid')!;
    expect(document.activeElement).toBe(grid);
    await m.run(() => fireEvent.keyDown(grid, { key: 'Escape' }));
    expect(m.q('.rich-editor__table-grid')).toBeNull();
    expect(saved(m.editor)).toBe('<p>a</p>');

    await m.click('Jadval');
    const grid2 = m.q('.rich-editor__table-grid')!;
    for (const key of ['ArrowRight', 'ArrowRight', 'ArrowDown']) {
      await m.run(() => fireEvent.keyDown(grid2, { key }));
    }
    expect(m.q('.rich-editor__table-size')?.textContent).toBe('2 × 3');
    await m.run(() => fireEvent.keyDown(grid2, { key: 'Enter' }));
    const html = m.editor.getHTML();
    expect(html.match(/<tr>/g)).toHaveLength(2);
    expect(html.match(/<td/g)).toHaveLength(6);
  });
});

describe('table cell popup', () => {
  const TABLE =
    '<table><tr><td><p>a</p></td><td><p>b</p></td></tr><tr><td><p>c</p></td><td><p>d</p></td></tr></table>';
  const text = (html: string) => html.replace(/<[^>]+>/g, '');

  it('merge is disabled for one cell and enabled for a cell selection', async () => {
    const m = await mount(TABLE);
    await m.cellPopup(m.cells()[0] + 2);
    expect(m.isDisabled('Yacheykalarni birlashtirish')).toBe(true);
    const [a, , c] = m.cells();
    await m.run(() => m.editor.commands.setCellSelection({ anchorCell: a, headCell: c }));
    expect(m.isDisabled('Yacheykalarni birlashtirish')).toBe(false);
    await m.click('Yacheykalarni birlashtirish');
    expect(await roundTrip(m.editor)).toContain('rowspan="2"');
  });

  it('new columns and rows land on the chosen side', async () => {
    const m = await mount(TABLE);
    await m.cellPopup(m.cells()[0] + 2);
    await m.click("Ustun qo'shish");
    await m.pick('Chap tomonga ustun');
    await m.click("Qator qo'shish");
    await m.pick('Tepaga qator');
    const rows = (m.editor.getHTML().match(/<tr>.*?<\/tr>/g) ?? []).map(text);
    expect(rows).toEqual(['', 'ab', 'cd']);
    expect(m.editor.getHTML().match(/<tr>.*?<\/tr>/g)![1]).toMatch(/^<tr><td[^>]*><p><\/p><\/td>/);
  });

  it('header row toggles on and off, and shows its state', async () => {
    const m = await mount(TABLE);
    await m.cellPopup(m.cells()[0] + 2);
    await m.click('Sarlavha qatori');
    expect(m.isOn('Sarlavha qatori')).toBe(true);
    expect(saved(m.editor).match(/<th/g)).toHaveLength(2);
    await m.click('Sarlavha qatori');
    expect(m.isOn('Sarlavha qatori')).toBe(false);
    expect(saved(m.editor)).not.toContain('<th');
  });

  it('colours: palette, custom colour, then "Rangsiz" clears', async () => {
    const m = await mount(TABLE);
    await m.cellPopup(m.cells()[0] + 2);
    await m.click('Yacheyka rangi');
    await m.run(() => fireEvent.click(m.q('.rich-editor__swatch[title="#D9EAD3"]')!));
    expect(m.isOn('Yacheyka rangi')).toBe(true);
    await m.click('Yacheyka rangi');
    await m.run(() =>
      fireEvent.change(m.q<HTMLInputElement>('.rich-editor__custom-color input')!, {
        target: { value: '#123456' },
      }),
    );
    expect(saved(m.editor)).toMatch(/background-color: (#123456|rgb\(18, 52, 86\))/);
    await m.click('Yacheyka rangi');
    const none = Array.from(
      m.container.querySelectorAll('.rich-editor__color-actions button'),
    ).find((b) => b.textContent === 'Rangsiz')!;
    await m.run(() => fireEvent.click(none));
    expect(saved(m.editor)).not.toContain('background-color');
    expect(m.isOn('Yacheyka rangi')).toBe(false);
  });

  it('vertical align and text align: set, shown on, "Standart" clears', async () => {
    const m = await mount(TABLE);
    await m.cellPopup(m.cells()[0] + 2);
    await m.click('Vertikal tekislash');
    await m.pick("O'rtaga");
    await m.click('Matnni tekislash');
    await m.pick('Markazga');
    expect(m.isOn('Vertikal tekislash')).toBe(true);
    expect(m.isOn('Matnni tekislash')).toBe(true);
    expect(saved(m.editor)).toContain('vertical-align: middle');
    await m.click('Vertikal tekislash');
    await m.pick('Standart');
    await m.click('Matnni tekislash');
    await m.pick('Standart');
    expect(saved(m.editor)).not.toMatch(/vertical-align|text-align/);
  });

  it('a colour applies to every cell of a cell selection', async () => {
    const m = await mount(TABLE);
    const [a, b] = m.cells();
    await m.run(() => m.editor.commands.setCellSelection({ anchorCell: a, headCell: b }));
    await m.run(() => fireEvent.keyDown(m.editor.view.dom, { key: 'F10', altKey: true }));
    await m.click('Yacheyka rangi');
    await m.run(() => fireEvent.click(m.q('.rich-editor__swatch[title="#FFF2CC"]')!));
    expect(saved(m.editor).match(/background-color/g)).toHaveLength(2);
  });

  it('Esc closes the popup and returns focus to the text', async () => {
    const m = await mount(TABLE);
    await m.cellPopup(m.cells()[0] + 2);
    await settle();
    await act(async () => fireEvent.keyDown(document.activeElement!, { key: 'Escape' }));
    // Tiptap hands focus back on the next animation frame.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(m.q('.rich-editor__cell-bubble')).toBeNull();
    expect(m.editor.isFocused || document.activeElement === m.editor.view.dom).toBe(true);
  });
});

describe('toolbar keyboard', () => {
  it('Alt+F10 outside a table or link focuses the toolbar; arrows walk it', async () => {
    const m = await mount('<p>a</p>');
    await m.select(2);
    await m.run(() => fireEvent.keyDown(m.editor.view.dom, { key: 'F10', altKey: true }));
    // The first enabled button: undo and redo come first but are off on a fresh editor.
    expect(document.activeElement).toBe(m.button('Abzats formati'));
    await m.run(() => fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' }));
    expect(document.activeElement).toBe(m.button('Qalin'));
    await m.run(() => fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' }));
    expect(document.activeElement).toBe(m.button('Kursiv'));
    await m.run(() => fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' }));
    expect(document.activeElement).toBe(m.button('Qalin'));
  });
});

describe('dropdown direction', () => {
  /** Pretend every popup measures as if it opened `top` px from the viewport top. */
  function popupsAt(top: number) {
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      return this.classList.contains('rich-editor__popup')
        ? new DOMRect(0, top, 180, 120)
        : original.call(this);
    };
    return () => {
      Element.prototype.getBoundingClientRect = original;
    };
  }
  const side = (m: Awaited<ReturnType<typeof mount>>) =>
    m.q('.rich-editor__popup')?.getAttribute('data-side');

  it.each(['Abzats formati', 'Tekislash', "Ro'yxat turi"])(
    '%s opens upwards when there is room, so the text stays visible',
    async (label) => {
      const restore = popupsAt(300);
      const m = await mount('<p>a</p>');
      await m.select(2);
      await m.run(() =>
        fireEvent.click(m.container.querySelector(`button[aria-label="${label}"]`)!),
      );
      expect(side(m)).toBe('top');
      restore();
    },
  );

  it('opens downwards when it would go under the topbar', async () => {
    const restore = popupsAt(20);
    const m = await mount('<p>a</p>');
    await m.select(2);
    await m.click('Abzats formati');
    expect(side(m)).toBe('bottom');
    restore();
  });

  it('cell popup dropdowns open upwards too', async () => {
    const restore = popupsAt(300);
    const m = await mount('<table><tr><td><p>a</p></td></tr></table>');
    await m.cellPopup(m.cells()[0] + 2);
    await m.click('Vertikal tekislash');
    expect(side(m)).toBe('top');
    restore();
  });

  it('popups without the triangle (link, table, symbols) still open downwards', async () => {
    const restore = popupsAt(300);
    const m = await mount('<p>a</p>');
    await m.select(2);
    for (const label of ['Havola', 'Jadval', 'Maxsus belgilar']) {
      await m.click(label);
      expect(side(m)).toBe('bottom');
      await m.run(() => fireEvent.keyDown(document.activeElement!, { key: 'Escape' }));
    }
    restore();
  });
});

describe('fixes from the second review', () => {
  it('custom colour: dragging in the picker does not close it; closing the picker applies', async () => {
    const m = await mount('<table><tr><td><p>a</p></td></tr></table>');
    await m.cellPopup(m.cells()[0] + 2);
    await m.click('Yacheyka rangi');
    const input = () => m.q<HTMLInputElement>('.rich-editor__custom-color input')!;
    // Each drag step is an `input` event: nothing applied, the popup stays.
    await m.run(() => fireEvent.input(input(), { target: { value: '#111111' } }));
    expect(input()).not.toBeNull();
    expect(saved(m.editor)).not.toContain('background-color');
    // Closing the picker fires `change` with the final colour.
    await m.run(() => fireEvent.change(input(), { target: { value: '#123456' } }));
    expect(saved(m.editor)).toMatch(/background-color: (#123456|rgb\(18, 52, 86\))/);
  });

  it('the text area is a named multi-line text box', async () => {
    const m = await mount('<p>a</p>');
    const pm = m.q('.ProseMirror')!;
    expect(pm.getAttribute('role')).toBe('textbox');
    expect(pm.getAttribute('aria-multiline')).toBe('true');
    expect(pm.getAttribute('aria-label')).toBe('Muharrir');
  });
});

describe('toolbar order', () => {
  it('history, block, text formatting, paragraph, insert, colours around and behind', async () => {
    const m = await mount('<p>a</p>');
    const labels = Array.from(
      m.container.querySelectorAll<HTMLButtonElement>('.rich-editor__toolbar button[aria-label]'),
    ).map((b) => b.getAttribute('aria-label'));
    const at = (l: string) => labels.indexOf(l);
    const order = [
      'Bekor qilish',
      'Qaytarish',
      'Abzats formati',
      'Qalin',
      'Kursiv',
      'Matn rangi',
      'Havola',
      'Formatni tozalash',
      'Tekislash',
      'Jadval',
      'Maxsus belgilar',
      'Rangli blok',
      'Umumiy fon',
    ];
    order.forEach((l) => expect(at(l)).toBeGreaterThanOrEqual(0));
    expect(order.map(at)).toEqual([...order.map(at)].sort((x, y) => x - y));
  });
});
