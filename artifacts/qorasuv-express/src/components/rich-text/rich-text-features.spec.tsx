/**
 * Every editor feature, end to end: done through the UI (toolbar, popups, keys),
 * then saved (normalizeHtml — the sanitiser), shown (sanitizeHtml — the read view)
 * and reloaded into a fresh editor. Each must survive all three unchanged, so a
 * stricter sanitiser can never silently break a feature.
 */
import { describe, it, expect } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import TiptapEditor from './tiptap-editor';
import { mount, roundTrip, settle } from './editor-test-utils';

const selectAll = (e: Editor) =>
  e.commands.setTextSelection({ from: 1, to: e.state.doc.content.size - 1 });

describe('text formatting', () => {
  it.each([
    ['Qalin', '<strong>abc</strong>'],
    ['Kursiv', '<em>abc</em>'],
    ['Tagiga chizilgan', '<u>abc</u>'],
    ['Ustiga chizilgan', '<s>abc</s>'],
  ])('%s', async (label, expected) => {
    const m = await mount('<p>abc</p>');
    await m.run(() => selectAll(m.editor));
    await m.click(label);
    expect(await roundTrip(m.editor)).toContain(expected);
  });

  it.each([
    ['Sarlavha 1', '<h1>abc</h1>'],
    ['Sarlavha 2', '<h2>abc</h2>'],
    ['Sarlavha 3', '<h3>abc</h3>'],
    ['Sarlavha 4', '<h4>abc</h4>'],
    ['Iqtibos', '<blockquote><p>abc</p></blockquote>'],
    ['Kod', '<pre><code>abc</code></pre>'],
  ])('paragraph menu: %s', async (item, expected) => {
    const m = await mount('<p>abc</p>');
    await m.run(() => m.editor.commands.setTextSelection(2));
    await m.click('Abzats formati');
    await m.pick(item);
    expect(await roundTrip(m.editor)).toBe(expected);
  });

  it.each([
    ['Markazga', 'center'],
    ["O'ngga", 'right'],
    ['Ikki tomonga', 'justify'],
  ])('align: %s', async (item, value) => {
    const m = await mount('<p>abc</p>');
    await m.run(() => m.editor.commands.setTextSelection(2));
    await m.click('Tekislash');
    await m.pick(item);
    expect(await roundTrip(m.editor)).toBe(`<p style="text-align: ${value};">abc</p>`);
  });

  it('clear formatting: button and Ctrl+Shift+M', async () => {
    for (const how of ['button', 'keys'] as const) {
      const m = await mount('<p style="text-align: center"><strong><em>abc</em></strong></p>');
      await m.run(() => selectAll(m.editor));
      if (how === 'button') await m.click('Formatni tozalash');
      else
        await m.run(() =>
          fireEvent.keyDown(m.editor.view.dom, {
            key: 'M',
            code: 'KeyM',
            keyCode: 77, // browsers send it; ProseMirror falls back to it for Shift+letter
            ctrlKey: true,
            shiftKey: true,
          }),
        );
      expect(await roundTrip(m.editor)).toBe('<p>abc</p>');
      m.unmount();
    }
  });

  it('text size from its menu, back to normal; stored relative, so the card scales it', async () => {
    const m = await mount('<p>abc</p>');
    await m.run(() => selectAll(m.editor));
    await m.click('Matn o‘lchami');
    await m.pick('Juda katta');
    expect(await roundTrip(m.editor)).toBe('<p><span style="font-size: 2.2em;">abc</span></p>');
    await m.run(() => selectAll(m.editor));
    await m.click('Matn o‘lchami');
    await m.pick('Oddiy');
    expect(await roundTrip(m.editor)).toBe('<p>abc</p>');
  });

  it('a size from elsewhere is not kept; a size with a colour keeps both', async () => {
    const m = await mount(
      '<p><span style="font-size: 11pt">ab</span><span style="font-size: 1.6em; color: #C00000">cd</span></p>',
    );
    const html = await roundTrip(m.editor);
    expect(html).not.toContain('11pt');
    expect(html).toContain('font-size: 1.6em');
    expect(html).toContain('color');
  });

  it('clear formatting takes the size away too', async () => {
    const m = await mount('<p><span style="font-size: 3em">abc</span></p>');
    await m.run(() => selectAll(m.editor));
    await m.click('Formatni tozalash');
    expect(await roundTrip(m.editor)).toBe('<p>abc</p>');
  });

  it('clear formatting keeps links and the block', async () => {
    const m = await mount(
      '<h2><em>t</em></h2><p>a <a href="https://mobi.uz"><strong>link</strong></a> b</p>',
    );
    await m.run(() => selectAll(m.editor));
    await m.click('Formatni tozalash');
    expect(await roundTrip(m.editor)).toBe(
      '<h2>t</h2><p>a <a href="https://mobi.uz">link</a> b</p>',
    );
  });

  it('clear formatting at a bare caret: what is typed next is plain', async () => {
    const m = await mount('<p><strong>bold</strong></p>');
    await m.run(() => m.editor.commands.setTextSelection(5));
    await m.click('Formatni tozalash');
    await m.run(() => m.editor.commands.insertContent('X'));
    expect(await roundTrip(m.editor)).toBe('<p><strong>bold</strong>X</p>');
  });

  it('undo and redo', async () => {
    const m = await mount('<p>abc</p>');
    await m.run(() => selectAll(m.editor));
    await m.click('Qalin');
    await m.click('Bekor qilish');
    expect(m.editor.getHTML()).toBe('<p>abc</p>');
    await m.click('Qaytarish');
    expect(m.editor.getHTML()).toBe('<p><strong>abc</strong></p>');
  });

  it('special characters (Uzbek oʻ)', async () => {
    const m = await mount('<p>o</p>');
    await m.run(() => m.editor.commands.setTextSelection(2));
    await m.click('Maxsus belgilar');
    await m.run(() => fireEvent.click(m.q('.rich-editor__symbol')!));
    expect(await roundTrip(m.editor)).toBe('<p>oʻ</p>');
  });

  it('horizontal rule', async () => {
    const m = await mount('<p>a</p>');
    await m.run(() => m.editor.commands.setHorizontalRule());
    expect(await roundTrip(m.editor)).toContain('<hr>');
  });
});

describe('lists', () => {
  it('bullet and ordered, toggled from the button', async () => {
    const m = await mount('<p>abc</p>');
    await m.run(() => m.editor.commands.setTextSelection(2));
    await m.click("Belgili ro'yxat");
    expect(await roundTrip(m.editor)).toBe('<ul><li><p>abc</p></li></ul>');
    await m.click("Raqamli ro'yxat");
    expect(await roundTrip(m.editor)).toBe('<ol><li><p>abc</p></li></ol>');
  });

  it.each([
    [0, 'Kvadrat', 'ul', 'square'],
    [1, 'Katta rim raqamlari (I, II)', 'ol', 'upper-roman'],
    [1, 'Yunon harflari (α, β, γ)', 'ol', 'lower-greek'],
  ])('list style: %s %s', async (arrow, item, tag, style) => {
    const m = await mount('<p>abc</p>');
    await m.run(() => m.editor.commands.setTextSelection(2));
    const arrows = m.container.querySelectorAll<HTMLElement>(`button[aria-label="Ro'yxat turi"]`);
    await m.run(() => fireEvent.click(arrows[arrow]));
    await m.pick(item);
    expect(await roundTrip(m.editor)).toContain(`<${tag} style="list-style-type: ${style};">`);
  });
});

describe('links', () => {
  async function openLinkForm(m: Awaited<ReturnType<typeof mount>>) {
    await m.run(() =>
      fireEvent.keyDown(m.editor.view.dom, { key: 'k', code: 'KeyK', ctrlKey: true }),
    );
    return m.q<HTMLInputElement>('.rich-editor__form input[type=url]')!;
  }

  it('editing a link keeps the rel words it had; the new-tab box only adds or removes its own', async () => {
    const m = await mount('<p><a href="https://a.uz" rel="nofollow ugc">abc</a></p>');
    await m.select(2);
    const url = await openLinkForm(m);
    const [newTab] = Array.from(
      m.container.querySelectorAll<HTMLInputElement>('.rich-editor__form input[type=checkbox]'),
    );
    await m.run(() => {
      fireEvent.change(url, { target: { value: 'https://b.uz' } });
      fireEvent.click(newTab);
    });
    await m.run(() => fireEvent.submit(url.form!));
    expect(await roundTrip(m.editor)).toBe(
      '<p><a target="_blank" rel="noopener noreferrer nofollow ugc" href="https://b.uz">abc</a></p>',
    );
    // New tab off again: its words go, the others stay.
    await m.select(2);
    const again = await openLinkForm(m);
    const [box] = Array.from(
      m.container.querySelectorAll<HTMLInputElement>('.rich-editor__form input[type=checkbox]'),
    );
    await m.run(() => fireEvent.click(box));
    await m.run(() => fireEvent.submit(again.form!));
    expect(await roundTrip(m.editor)).toBe(
      '<p><a rel="nofollow ugc" href="https://b.uz">abc</a></p>',
    );
  });

  it('inserts a link that opens in a new tab; there is no "nofollow" option', async () => {
    const m = await mount('<p>abc</p>');
    await m.run(() => selectAll(m.editor));
    const url = await openLinkForm(m);
    const checks = Array.from(
      m.container.querySelectorAll<HTMLInputElement>('.rich-editor__form input[type=checkbox]'),
    );
    expect(checks).toHaveLength(1);
    await m.run(() => {
      fireEvent.change(url, { target: { value: 'https://mobi.uz' } });
      fireEvent.click(checks[0]);
    });
    await m.run(() => fireEvent.submit(url.form!));
    expect(await roundTrip(m.editor)).toBe(
      '<p><a target="_blank" rel="noopener noreferrer" href="https://mobi.uz">abc</a></p>',
    );
  });

  it.each(['mailto:info@mobi.uz', 'tel:+998901234567'])('accepts %s', async (href) => {
    const m = await mount('<p>abc</p>');
    await m.run(() => selectAll(m.editor));
    const url = await openLinkForm(m);
    await m.run(() => fireEvent.change(url, { target: { value: href } }));
    await m.run(() => fireEvent.submit(url.form!));
    expect(await roundTrip(m.editor)).toBe(`<p><a href="${href}">abc</a></p>`);
  });

  it('refuses javascript: in the form', async () => {
    const m = await mount('<p>abc</p>');
    await m.run(() => selectAll(m.editor));
    const url = await openLinkForm(m);
    await m.run(() => fireEvent.change(url, { target: { value: 'javascript:alert(1)' } }));
    await m.run(() => fireEvent.submit(url.form!));
    expect(m.q('.rich-editor__hint[data-error]')).not.toBeNull();
    expect(m.editor.getHTML()).toBe('<p>abc</p>');
  });

  it('link popup on click: edit, then unlink', async () => {
    const m = await mount('<p><a href="https://a.uz">abc</a></p>');
    await m.run(() => {
      m.editor.commands.setTextSelection(2);
      fireEvent.mouseUp(m.q('.ProseMirror a')!);
    });
    await m.click('Havolani tahrirlash');
    const url = m.q<HTMLInputElement>('.rich-editor__form input[type=url]')!;
    await m.run(() => fireEvent.change(url, { target: { value: 'https://b.uz' } }));
    await m.run(() => fireEvent.submit(url.form!));
    expect(await roundTrip(m.editor)).toBe('<p><a href="https://b.uz">abc</a></p>');

    await m.run(() => {
      m.editor.commands.setTextSelection(2);
      fireEvent.mouseUp(m.q('.ProseMirror a')!);
    });
    await m.click('Havolani olib tashlash');
    expect(await roundTrip(m.editor)).toBe('<p>abc</p>');
  });
});

describe('tables', () => {
  const cells = (e: Editor) => {
    const out: number[] = [];
    e.state.doc.descendants((n, pos) => {
      if (n.type.name === 'tableCell' || n.type.name === 'tableHeader') out.push(pos);
    });
    return out;
  };

  it('inserts from the picker, with text, and survives save/reload', async () => {
    const m = await mount('');
    await m.click('Jadval');
    const grid = m.container.querySelectorAll('.rich-editor__table-cell');
    await m.run(() => fireEvent.click(grid[12])); // 2 × 3
    await m.run(() => m.editor.commands.insertContent('x'));
    const stored = await roundTrip(m.editor);
    expect(stored.match(/<tr>/g)).toHaveLength(2);
    expect(stored.match(/<td/g)).toHaveLength(6);
    expect(stored).toContain('<table style="border-collapse: collapse; width: 100%;">');
  });

  it('header row, colours, vertical and text alignment', async () => {
    const m = await mount('<table><tr><td><p>a</p></td><td><p>b</p></td></tr></table>');
    await m.cellPopup(cells(m.editor)[0] + 2);
    await m.click('Sarlavha qatori');
    await m.click('Yacheyka rangi');
    await m.run(() => fireEvent.click(m.q('.rich-editor__swatch[title="#FFF2CC"]')!));
    await m.click('Yacheyka rangi');
    await m.run(() => fireEvent.click(Array.from(m.container.querySelectorAll('[role=tab]'))[1]));
    await m.run(() => fireEvent.click(m.q('.rich-editor__swatch[title="#CC0000"]')!));
    await m.click('Yacheyka rangi');
    await m.run(() => fireEvent.click(Array.from(m.container.querySelectorAll('[role=tab]'))[2]));
    await m.run(() => fireEvent.click(m.q('.rich-editor__swatch[title="#0000FF"]')!));
    await m.click('Vertikal tekislash');
    await m.pick('Pastga');
    await m.click('Matnni tekislash');
    await m.pick('Ikki tomonga');
    const stored = await roundTrip(m.editor);
    expect(stored).toMatch(/<th [^>]*style="[^"]*background-color: (#FFF2CC|rgb\(255, 242, 204\))/);
    expect(stored).toMatch(/color: (#CC0000|rgb\(204, 0, 0\))/);
    expect(stored).toMatch(/border-color: (#0000FF|rgb\(0, 0, 255\))/);
    expect(stored).toContain('vertical-align: bottom');
    expect(stored).toContain('text-align: justify');
    expect(stored.match(/<th/g)).toHaveLength(2);
  });

  it('add/delete rows and columns, empty a cell, delete the table', async () => {
    const m = await mount('<table><tr><td><p>a</p></td><td><p>b</p></td></tr></table>');
    await m.cellPopup(cells(m.editor)[0] + 2);
    await m.click("Qator qo'shish");
    await m.pick('Pastga qator');
    await m.click("Ustun qo'shish");
    await m.pick("O'ng tomonga ustun");
    const stored = await roundTrip(m.editor);
    expect(stored.match(/<tr>/g)).toHaveLength(2);
    expect(stored.match(/<td/g)).toHaveLength(6);

    await m.cellPopup(cells(m.editor)[0] + 2);
    await m.click("O'chirish");
    await m.pick("Ustunni o'chirish");
    await m.click("O'chirish");
    await m.pick("Qatorni o'chirish");
    // What is left is the new, empty row: on screen 2 cells; stored as nothing, since a
    // table without text is blank like an empty paragraph.
    expect(m.editor.getHTML().match(/<td/g)).toHaveLength(2);
    expect(await roundTrip(m.editor)).toBe('');

    await m.cellPopup(cells(m.editor)[1] + 2);
    await m.click("O'chirish");
    await m.pick('Yacheykani tozalash');
    expect(m.editor.getHTML()).toContain('<td><p></p></td>');

    await m.cellPopup(cells(m.editor)[0] + 2);
    await m.click("O'chirish");
    await m.pick("Jadvalni o'chirish");
    expect(m.editor.getHTML()).not.toContain('<table');
  });

  it('merge, then split vertically and horizontally', async () => {
    const m = await mount(
      '<table><tr><td><p>a</p></td><td><p>b</p></td></tr><tr><td><p>c</p></td><td><p>d</p></td></tr></table>',
    );
    const [a, b] = cells(m.editor);
    await m.run(() => m.editor.commands.setCellSelection({ anchorCell: a, headCell: b }));
    await m.run(() => fireEvent.keyDown(m.editor.view.dom, { key: 'F10', altKey: true }));
    await m.click('Yacheykalarni birlashtirish');
    expect(await roundTrip(m.editor)).toContain('colspan="2"');

    await m.cellPopup(cells(m.editor)[0] + 2);
    await m.click('Ajratish');
    await m.pick('Vertikal ajratish');
    let stored = await roundTrip(m.editor);
    expect(stored).not.toContain('colspan');

    await m.cellPopup(cells(m.editor)[0] + 2);
    await m.click('Ajratish');
    await m.pick('Gorizontal ajratish');
    stored = await roundTrip(m.editor);
    expect(stored).toContain('rowspan="2"');
  });

  it('dragged column widths are stored as percentages', async () => {
    const m = await mount(
      '<table><tr><td colwidth="100"><p>a</p></td><td colwidth="300"><p>b</p></td></tr></table>',
    );
    const stored = await roundTrip(m.editor);
    expect(stored).toContain('<col style="width: 25%;"><col style="width: 75%;">');
    expect(stored).toContain('colwidth="100"');
  });
});

describe('paste', () => {
  it('Google Docs keeps bold, italic and underline (and is not all bold)', async () => {
    const m = await mount('');
    await m.run(() =>
      m.editor.view.pasteHTML(
        '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span style="font-weight:700;">Bold</span><span style="font-weight:400;"> plain </span><span style="font-style:italic;">ital</span> <span style="text-decoration:underline;">und</span></p></b>',
      ),
    );
    expect(await roundTrip(m.editor)).toBe(
      '<p><strong>Bold</strong> plain <em>ital</em> <u>und</u></p>',
    );
  });

  it('Word keeps headings, lists and tables; drops its styling', async () => {
    const m = await mount('');
    await m.run(() =>
      m.editor.view.pasteHTML(
        '<h2 style="mso-style:x;font-family:Calibri">Shartlar</h2><ul><li style="color:#333">bir</li></ul><table class="MsoTable" style="border:none"><tr><td style="width:100pt;background:yellow">a</td><td>b</td></tr></table>',
      ),
    );
    const stored = await roundTrip(m.editor);
    expect(stored).toContain('<h2>Shartlar</h2>');
    expect(stored).toContain('<ul><li><p>bir</p></li></ul>');
    expect(stored).toContain('<table');
    expect(stored).not.toMatch(/mso|Calibri|MsoTable/);
  });

  it('plain text from Telegram', async () => {
    const m = await mount('');
    await m.run(() => m.editor.view.pasteText('1-band\n2-band\n\nYangi abzats'));
    expect(await roundTrip(m.editor)).toBe('<p>1-band<br>2-band</p><p>Yangi abzats</p>');
  });
});

describe('editor surface', () => {
  it('placeholder, language and spell-check', async () => {
    const view = render(<TiptapEditor value="" lang="uz" onChange={() => {}} />);
    await settle();
    const pm = view.container.querySelector('.ProseMirror')!;
    expect(pm.querySelector('.is-empty')?.getAttribute('data-placeholder')).toBe('Matn kiriting…');
    expect(pm.getAttribute('lang')).toBe('uz');
    expect(pm.getAttribute('spellcheck')).toBe('false');
  });
});
