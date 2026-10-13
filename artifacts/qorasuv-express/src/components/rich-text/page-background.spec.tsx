/**
 * The page background ("Umumiy fon"): one colour behind all the text of a language,
 * stored as an outer <div>, kept readable, and carried along when all the text is
 * copied into another language's editor.
 */
import { describe, it, expect } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { mount, roundTrip, saved, settle, type Mounted } from './editor-test-utils';
import TiptapEditor from './tiptap-editor';
import { RichHtmlView } from './rich-html-field';
import { htmlEquals, joinPage, normalizeHtml, splitPage } from '../../lib/rich-html';

const swatch = (m: Mounted, c: string) => m.q(`.rich-editor__swatch[aria-label="${c}"]`)!;
const tab = (m: Mounted, name: string) =>
  Array.from(m.container.querySelectorAll('[role=tab]')).find((b) => b.textContent === name)!;
const textButton = (m: Mounted, text: string) =>
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
const PAGE = (colors: string, inner: string) =>
  `<div style="${colors} padding: 0.6em;">${inner}</div>`;
const BOX = (style: string, inner: string) =>
  `<div style="padding: 0.6em 0.8em; border-radius: 4px; ${style}">${inner}</div>`;

async function pickPage(m: Mounted, color: string, kind = 'Fon') {
  await m.click('Umumiy fon');
  if (kind !== 'Fon') await m.run(() => fireEvent.click(tab(m, kind)));
  await m.run(() =>
    fireEvent.click(color === 'Rangsiz' ? textButton(m, 'Rangsiz') : swatch(m, color)),
  );
}

/** A copy or cut event with a writable clipboard, as a browser hands it over. */
function clipboardEvent(type: 'copy' | 'cut') {
  const store = new Map<string, string>();
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    clipboardData: Pick<DataTransfer, 'setData' | 'getData' | 'clearData'>;
  };
  event.clipboardData = {
    setData: (format: string, data: string) => void store.set(format, data),
    getData: (format: string) => store.get(format) ?? '',
    clearData: () => store.clear(),
  };
  return { event, store };
}

describe('stored form', () => {
  it('reads the outer <div> that sets only colours as the page, not a coloured box', () => {
    const page = PAGE('background-color: #000000; color: #FFFFFF;', '<p>a</p>');
    expect(splitPage(page)).toEqual({
      page: { backgroundColor: 'rgb(0, 0, 0)', color: 'rgb(255, 255, 255)' },
      body: '<p>a</p>',
    });
    // Around a copied fragment (comments, <meta>) it is still the page.
    expect(
      splitPage(`<meta charset="utf-8"><!--StartFragment-->${page}<!--EndFragment-->`).page,
    ).not.toBeNull();
    // The coloured box, a div with more than colours, or one among others: not the page.
    expect(splitPage(BOX('background-color: #FFF2CC;', '<p>a</p>')).page).toBeNull();
    expect(
      splitPage('<div style="background-color: red; border: 1px solid red">a</div>').page,
    ).toBeNull();
    expect(splitPage(`${page}<p>b</p>`).page).toBeNull();
    expect(splitPage('<div style="padding: 4px"><p>a</p></div>').page).toBeNull();
  });

  it('saves the page around the text, trims the trailing empty line inside it', () => {
    const page = PAGE('background-color: #fff2cc;', '<p>a</p><p></p><p><br></p>');
    // Its colours as the browser reads them (rgb), as the coloured box stores its own.
    const stored = PAGE('background-color: rgb(255, 242, 204);', '<p>a</p>');
    expect(normalizeHtml(page)).toBe(stored);
    expect(normalizeHtml(stored)).toBe(stored);
    // A page with no text in it is no text.
    expect(normalizeHtml(PAGE('background-color: #fff2cc;', '<p></p>'))).toBe('');
    // A colour that is not one never reaches the style attribute.
    expect(joinPage('<p>a</p>', { backgroundColor: 'red;"><script>', color: null })).toBe(
      '<p>a</p>',
    );
    expect(
      htmlEquals(
        PAGE('background-color: #fff2cc;', '<p>a</p>'),
        PAGE('background-color: #FFF2CC;', '<p>a</p>'),
      ),
    ).toBe(true);
    expect(htmlEquals(PAGE('background-color: #fff2cc;', '<p>a</p>'), '<p>a</p>')).toBe(false);
  });

  it('a dark page background without a text colour gets white text, as the picker gives', () => {
    expect(normalizeHtml(PAGE('background-color: #000000;', '<p>a</p>'))).toBe(
      PAGE('background-color: rgb(0, 0, 0); color: rgb(255, 255, 255);', '<p>a</p>'),
    );
  });
});

describe('in the editor', () => {
  it('loads a stored page as the background of the whole text area, unchanged', async () => {
    const stored = PAGE('background-color: rgb(255, 242, 204);', '<p>a</p>');
    let loaded = '';
    const view = render(
      <TiptapEditor value={stored} onChange={() => {}} onLoad={(h) => (loaded = h)} />,
    );
    await settle();
    const area = view.container.querySelector<HTMLElement>('.ProseMirror')!;
    expect(area.style.backgroundColor).toBe('rgb(255, 242, 204)');
    expect(normalizeHtml(loaded)).toBe(stored);
    // The page is not content: no coloured box shows up in the text.
    expect(area.querySelector('div[style]')).toBeNull();
  });

  it('a dark background turns all the text white, also a line typed at the end', async () => {
    const m = await mount('<p>a</p><p>b</p>');
    await pickPage(m, '#000000');
    expect(hex(saved(m.editor))).toBe(
      PAGE('background-color: #000000; color: #FFFFFF;', '<p>a</p><p>b</p>'),
    );
    expect(m.isOn('Umumiy fon')).toBe(true);
    await act(async () => {
      m.editor.chain().focus('end').insertContent('c').run();
    });
    await settle();
    expect(hex(saved(m.editor))).toBe(
      PAGE('background-color: #000000; color: #FFFFFF;', '<p>a</p><p>bc</p>'),
    );
    expect(hex(await roundTrip(m.editor))).toBe(hex(saved(m.editor)));
  });

  it('colours are judged against the page: no black text on black, a light box gets black text', async () => {
    const m = await mount(BOX('background-color: #FFF2CC; border: 1px solid #DADADA;', '<p>a</p>'));
    await pickPage(m, '#000000');
    const out = hex(saved(m.editor));
    expect(out).toContain('background-color: #FFF2CC; color: #000000;');
    await m.select(3);
    await m.click('Matn rangi');
    // Inside the light box black is fine; outside it, on the black page, it is not.
    expect(swatch(m, '#000000').getAttribute('aria-disabled')).not.toBe('true');
    await m.run(() => fireEvent.keyDown(m.q('[role=dialog]')!, { key: 'Escape' }));
    await act(async () => {
      m.editor.chain().focus('end').run();
    });
    await settle();
    await m.click('Matn rangi');
    expect(swatch(m, '#000000').getAttribute('aria-disabled')).toBe('true');
  });

  it('"Rangsiz" takes the page away with its white text; one undo brings both back', async () => {
    const m = await mount('<p>a</p>');
    await pickPage(m, '#000000');
    await pickPage(m, 'Rangsiz');
    expect(saved(m.editor)).toBe('<p>a</p>');
    expect(m.isOn('Umumiy fon')).toBe(false);
    await m.run(() => m.editor.commands.undo());
    expect(hex(saved(m.editor))).toBe(
      PAGE('background-color: #000000; color: #FFFFFF;', '<p>a</p>'),
    );
    await m.run(() => m.editor.commands.undo());
    expect(saved(m.editor)).toBe('<p>a</p>');
  });

  it('a page text colour alone is kept too', async () => {
    const m = await mount('<p>a</p>');
    await pickPage(m, '#1155CC', 'Matn');
    expect(hex(saved(m.editor))).toBe(PAGE('color: #1155CC;', '<p>a</p>'));
    expect(hex(await roundTrip(m.editor))).toBe(PAGE('color: #1155CC;', '<p>a</p>'));
  });
});

describe('copy and paste', () => {
  const page = PAGE('background-color: rgb(255, 242, 204);', '<p>Bir</p><p>Ikki</p>');

  it('copying all the text takes the page along; a part does not', async () => {
    const m = await mount(page);
    await m.run(() => m.editor.commands.selectAll());
    const all = clipboardEvent('copy');
    m.editor.view.dom.dispatchEvent(all.event);
    expect(all.store.get('text/html')).toMatch(
      /^<div style="background-color: rgb\(255, 242, 204\);/,
    );
    expect(all.store.get('text/html')).toContain('data-pm-slice');
    expect(all.store.get('text/plain')).toContain('Bir');

    // Dragged from the first letter to the last (not Ctrl+A) is all the text too.
    await m.select(1, 10);
    const dragged = clipboardEvent('copy');
    m.editor.view.dom.dispatchEvent(dragged.event);
    expect(dragged.store.get('text/html')).toMatch(/^<div style="background-color/);

    await m.select(1, 3);
    const part = clipboardEvent('copy');
    m.editor.view.dom.dispatchEvent(part.event);
    expect(part.store.get('text/html') ?? '').not.toContain('background-color');
  });

  it('cutting all the text takes the page along and empties the editor', async () => {
    const m = await mount(page);
    await m.run(() => m.editor.commands.selectAll());
    const cut = clipboardEvent('cut');
    await m.run(() => m.editor.view.dom.dispatchEvent(cut.event));
    expect(cut.store.get('text/html')).toMatch(/^<div style="background-color/);
    expect(m.editor.state.doc.textContent).toBe('');
  });

  async function copied(html: string) {
    const m = await mount(html);
    await m.run(() => m.editor.commands.selectAll());
    const { event, store } = clipboardEvent('copy');
    m.editor.view.dom.dispatchEvent(event);
    m.unmount();
    return store.get('text/html')!;
  }

  it('pasted into an empty editor, the text comes with its page', async () => {
    const html = await copied(page);
    const m = await mount('');
    await m.run(() => m.editor.view.pasteHTML(html));
    expect(saved(m.editor)).toBe(normalizeHtml(page));
  });

  it('pasted over all the text, the page replaces this one', async () => {
    const html = await copied(page);
    const m = await mount(PAGE('background-color: rgb(207, 226, 243);', '<p>Eski</p>'));
    await m.run(() => m.editor.commands.selectAll());
    await m.run(() => m.editor.view.pasteHTML(html));
    expect(saved(m.editor)).toBe(normalizeHtml(page));
  });

  it('pasted into the text, only the text comes; this page stays', async () => {
    const html = await copied(page);
    const own = 'background-color: rgb(207, 226, 243);';
    const m = await mount(PAGE(own, '<p>Eski</p>'));
    await m.select(5);
    await m.run(() => m.editor.view.pasteHTML(html));
    const out = saved(m.editor);
    expect(out.startsWith(`<div style="${own}`)).toBe(true);
    expect(out).toContain('Bir');
    expect(out).not.toContain('255, 242, 204');
    // Nor did the copied page turn into a coloured box in the text.
    expect(out).not.toContain('border-radius');

    // On a plain page, the same: text only.
    const n = await mount('<p>Eski</p>');
    await n.select(5);
    await n.run(() => n.editor.view.pasteHTML(html));
    expect(saved(n.editor)).not.toContain('background-color');
  });

  it('a page-like <div> from outside the editor is not a page', async () => {
    const m = await mount('');
    await m.run(() =>
      m.editor.view.pasteHTML('<div style="background-color: #000000; color: #ffffff">a</div>'),
    );
    expect(saved(m.editor)).toBe('<p>a</p>');
  });
});

describe('read view', () => {
  it('the page background fills the frame', async () => {
    const value = { uz: PAGE('background-color: #fff2cc;', '<p>a</p>'), ru: '<p>b</p>' };
    const view = render(<RichHtmlView value={value} />);
    await settle();
    const frame = view.container.querySelector<HTMLElement>('.rich-text-content')!;
    expect(frame.style.padding).toBe('0px');
    expect(frame.firstElementChild?.getAttribute('style')).toContain('background-color');
  });
});

describe('review fixes', () => {
  const DARK = 'background-color: #000000; color: #FFFFFF;';

  it('a pasted highlight is made readable on the page it lands on, in the paste undo step', async () => {
    const m = await mount(PAGE(DARK, '<p>abc</p>'));
    await m.select(3);
    await m.run(() =>
      m.editor.view.pasteHTML(
        '<p data-pm-slice="1 1 []"><span style="background-color: #FFFF00">hi</span></p>',
      ),
    );
    // White page text on the yellow highlight would not show: the letters turn black.
    const out = hex(saved(m.editor));
    const span = /<span style="([^"]*)">hi<\/span>/.exec(out)?.[1] ?? '';
    expect(span).toContain('background-color: #FFFF00;');
    expect(span).toMatch(/(^|; )color: #000000;/);
    // What the editor shows is what is saved.
    expect(hex(await roundTrip(m.editor))).toBe(out);
    // One undo takes the paste away whole.
    await m.run(() => m.editor.commands.undo());
    expect(hex(saved(m.editor))).toBe(hex(normalizeHtml(PAGE(DARK, '<p>abc</p>'))));
  });

  it('pasted black letters in a black cell lose their colour (the cell text shows)', async () => {
    const m = await mount(
      '<table><tbody><tr><td style="background-color: #000000; color: #FFFFFF"><p>ab</p></td></tr></tbody></table>',
    );
    const [cell] = m.cells();
    await m.select(cell + 2);
    await m.run(() =>
      m.editor.view.pasteHTML(
        '<p data-pm-slice="1 1 []"><span style="color: #000000">dark</span></p>',
      ),
    );
    expect(saved(m.editor)).toContain('<p>darkab</p>');
    expect(m.editor.getHTML()).not.toContain('<span');
  });

  it('copying all cells of a table takes the page along', async () => {
    const m = await mount(
      PAGE(
        'background-color: rgb(255, 242, 204);',
        '<table><tbody><tr><td><p>a</p></td><td><p>b</p></td></tr></tbody></table>',
      ),
    );
    const [a, b] = m.cells();
    await m.run(() => m.editor.commands.setCellSelection({ anchorCell: a, headCell: b }));
    const { event, store } = clipboardEvent('copy');
    m.editor.view.dom.dispatchEvent(event);
    expect(store.get('text/html')).toMatch(/^<div style="background-color: rgb\(255, 242, 204\);/);
  });

  it('a page set before any text survives a remount, and an empty language still saves nothing', async () => {
    let value = '';
    const view = render(<TiptapEditor value="" onChange={(h) => (value = h)} />);
    await settle();
    const button = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Umumiy fon"]',
    )!;
    await act(async () => fireEvent.click(button));
    await settle();
    await act(async () =>
      fireEvent.click(view.container.querySelector('.rich-editor__swatch[aria-label="#000000"]')!),
    );
    await settle();
    expect(splitPage(value).page).not.toBeNull();
    expect(normalizeHtml(value)).toBe('');
    expect(htmlEquals(value, '')).toBe(true);
    view.unmount();
    // Back on this language: the page is still there.
    const again = render(<TiptapEditor value={value} onChange={() => {}} />);
    await settle();
    expect(again.container.querySelector<HTMLElement>('.ProseMirror')!.style.backgroundColor).toBe(
      'rgb(0, 0, 0)',
    );
  });

  it('deleting all the text and typing again keeps the page', async () => {
    const m = await mount(PAGE(DARK, '<p>a</p>'));
    await m.run(() => m.editor.chain().selectAll().deleteSelection().run());
    await act(async () => {
      m.editor.chain().focus().insertContent('b').run();
    });
    await settle();
    expect(hex(saved(m.editor))).toBe(PAGE(DARK, '<p>b</p>'));
  });
});

describe('pasting cells into a table', () => {
  it('pasted cell content is made readable too (the table plugin pastes it itself)', async () => {
    const m = await mount(
      PAGE(
        'background-color: #000000; color: #FFFFFF;',
        '<table><tbody><tr><td><p>a</p></td><td><p>b</p></td></tr></tbody></table>',
      ),
    );
    const [a, b] = m.cells();
    await m.run(() => m.editor.commands.setCellSelection({ anchorCell: a, headCell: b }));
    await m.run(() =>
      m.editor.view.pasteHTML(
        '<table data-pm-slice="1 1 []"><tbody><tr><td><p><span style="color: #000000">x</span></p></td><td><p>y</p></td></tr></tbody></table>',
      ),
    );
    // Black on the black page would not show: the colour goes in the editor already.
    expect(m.editor.getHTML()).toContain('x');
    expect(m.editor.getHTML()).not.toContain('color: rgb(0, 0, 0);">x');
    expect(saved(m.editor)).not.toContain('<span');
  });
});

describe('read view language', () => {
  it("shows only the panel's language, without tabs and without falling back", async () => {
    const view = render(<RichHtmlView value={{ uz: '<p>uzbekcha</p>', ru: '<p>русский</p>' }} />);
    await settle();
    expect(view.container.textContent).toContain('uzbekcha');
    expect(view.container.textContent).not.toContain('русский');
    expect(view.container.querySelectorAll('button')).toHaveLength(0);
    view.unmount();
    // Blank in the panel's language: "—", not another language's text.
    const blank = render(<RichHtmlView value={{ ru: '<p>русский</p>' }} />);
    await settle();
    expect(blank.container.textContent).toBe('—');
  });
});
