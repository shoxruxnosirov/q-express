import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import TiptapEditor from './tiptap-editor';
import { RichHtmlField } from './rich-html-field';
import { normalizeHtml } from '../../lib/rich-html';
import { LanguageProvider, useLanguage } from '@/i18n';

// jsdom has no ClipboardEvent; ProseMirror's pasteText/pasteHTML build one.
(globalThis as unknown as { ClipboardEvent: unknown }).ClipboardEvent ??= class extends Event {
  clipboardData = null;
};
// jsdom has no layout; ProseMirror measures ranges when it scrolls the caret into view.
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

// The field loads its editors lazily (React.lazy). The editor module is already
// imported above, so the lazy one resolves at once and settle() lets it render
// (the tests use the "Text" mode only).

const settle = () =>
  act(async () => {
    // Past the next animation frame: Tiptap hands focus back to the text on one.
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  });

async function mount(value = '', onChange: (h: string) => void = () => {}) {
  const view = render(<TiptapEditor value={value} onChange={onChange} />);
  await settle();
  const editor = (view.container.querySelector('.ProseMirror') as unknown as { editor: Editor })
    .editor;
  const button = (label: string) =>
    view.container.querySelector<HTMLElement>(`button[aria-label="${label}"]`)!;
  return { ...view, editor, button };
}

describe('TiptapEditor', () => {
  it('does not re-apply its options on every render', async () => {
    const { editor, rerender } = await mount('<p>a</p>');
    const setOptions = vi.spyOn(editor, 'setOptions');
    for (let i = 0; i < 5; i += 1) rerender(<TiptapEditor value="<p>a</p>" onChange={() => {}} />);
    await settle();
    expect(setOptions).not.toHaveBeenCalled();
  });

  it('cleans pasted HTML before the schema sees it', async () => {
    const { editor } = await mount();
    await act(async () => {
      editor.view.pasteHTML(
        '<p style="position:fixed;color:red">a</p><table><tr><td colspan="99999">b</td></tr></table>',
      );
    });
    const html = editor.getHTML();
    expect(html).not.toContain('position');
    expect(html.length).toBeLessThan(5000);
  });

  it('pastes plain text with collapsed spaces, <br> lines and blank-line paragraphs', async () => {
    const { editor } = await mount();
    await act(async () => {
      editor.view.pasteText('  a   b\tc\nnext line\n\n\nnew paragraph\n');
    });
    expect(editor.getHTML()).toBe('<p>a b c<br>next line</p><p>new paragraph</p>');
  });

  it('opens the link popup with Ctrl+K on any keyboard layout', async () => {
    const { editor, container } = await mount('<p>abc</p>');
    await act(async () => {
      editor.commands.setTextSelection({ from: 1, to: 4 });
      fireEvent.keyDown(editor.view.dom, { key: 'л', code: 'KeyK', ctrlKey: true });
    });
    expect(container.querySelector('.rich-editor__form')).not.toBeNull();
  });

  it('keeps the formatting inside a link when only the address changes', async () => {
    const { editor } = await mount('<p><a href="https://a.uz"><strong>bold</strong> text</a></p>');
    await act(async () => {
      editor.commands.setTextSelection(3);
      fireEvent.keyDown(editor.view.dom, { key: 'k', code: 'KeyK', ctrlKey: true });
    });
    const url = document.querySelector<HTMLInputElement>('.rich-editor__form input[type=url]')!;
    await act(async () => {
      fireEvent.change(url, { target: { value: 'https://b.uz' } });
      fireEvent.submit(url.form!);
    });
    expect(editor.getHTML()).toBe('<p><a href="https://b.uz"><strong>bold</strong> text</a></p>');
  });

  it('reaches the cell popup from the keyboard and closes menus one level at a time', async () => {
    const { editor, container, button } = await mount(
      '<table><tr><td><p>a</p></td><td><p>b</p></td></tr></table>',
    );
    await act(async () => {
      editor.commands.setTextSelection(3);
      fireEvent.keyDown(editor.view.dom, { key: 'F10', altKey: true });
    });
    await settle();
    const bubble = () => container.querySelector('.rich-editor__cell-bubble');
    expect(bubble()).not.toBeNull();
    expect(bubble()!.contains(document.activeElement)).toBe(true);

    await act(async () => fireEvent.click(button('Vertikal tekislash')));
    await settle();
    const focused = document.activeElement as HTMLElement;
    expect(focused.getAttribute('role')).toBe('menuitemradio');
    await act(async () => fireEvent.keyDown(focused, { key: 'ArrowDown' }));
    expect(document.activeElement).not.toBe(focused);

    await act(async () => fireEvent.keyDown(document.activeElement!, { key: 'Escape' }));
    expect(container.querySelector('[role=menu]')).toBeNull();
    expect(bubble()).not.toBeNull();
    expect(document.activeElement).toBe(button('Vertikal tekislash'));

    await act(async () => fireEvent.keyDown(document.activeElement!, { key: 'Escape' }));
    expect(bubble()).toBeNull();
  });

  it('recognises a stored cell colour that the browser turned into rgb()', async () => {
    const { editor, container, button } = await mount(
      '<table><tr><td style="background-color: #FFF2CC"><p>a</p></td></tr></table>',
    );
    await act(async () => {
      editor.commands.setTextSelection(3);
      fireEvent.keyDown(editor.view.dom, { key: 'F10', altKey: true });
    });
    await settle();
    await act(async () => fireEvent.click(button('Yacheyka rangi')));
    const selected = container.querySelector('.rich-editor__swatch[aria-selected="true"]');
    expect(selected?.getAttribute('title')).toBe('#FFF2CC');
  });
});

describe('RichHtmlField', () => {
  it('does not mark a no-op load as changed when only whitespace differs', async () => {
    const onChange = vi.fn();
    render(
      <RichHtmlField
        value={{ uz: '<p>two  spaces </p>' }}
        original={{ uz: '<p>two  spaces </p>' }}
        onChange={onChange}
      />,
    );
    await settle();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('round-trips a table through save and reload unchanged', async () => {
    let html = '';
    const first = await mount('', (h) => (html = h));
    await act(async () => {
      first.editor.commands.setContent(
        '<table><tr><th><p>H</p></th><th><p>I</p></th></tr><tr><td style="background-color: #FFF2CC"><p>a</p></td><td><p>b</p></td></tr></table>',
        { emitUpdate: true },
      );
    });
    const stored = normalizeHtml(html);
    first.unmount();
    let loaded = '';
    render(<TiptapEditor value={stored} onChange={() => {}} onLoad={(h) => (loaded = h)} />);
    await settle();
    expect(normalizeHtml(loaded)).toBe(stored);
  });
});

describe('RichHtmlField: layout', () => {
  it('the Text / HTML switch and the language tabs share one row, languages on the right', async () => {
    const view = render(<RichHtmlField value={{ uz: '<p>a</p>' }} onChange={() => {}} />);
    await settle();
    const modes = view.getByRole('radiogroup', { name: "Ko'rinish" });
    const uz = view.getByRole('button', { name: "O'zbekcha" });
    const row = modes.parentElement!;
    // Same row: the switch first, then the box of language tabs pushed to the right.
    expect(uz.parentElement!.parentElement).toBe(row);
    expect(row.firstElementChild).toBe(modes);
    expect(row.lastElementChild).toBe(uz.parentElement);
    expect(uz.parentElement!.style.marginLeft).toBe('auto');
    expect(row.style.flexWrap).toBe('wrap');
  });
});

describe('RichHtmlField: rewrite notice', () => {
  const notice = (c: HTMLElement) => c.querySelector('[role=note]');

  it('no false alarm when only equivalent tags change (<b> → <strong>)', async () => {
    const view = render(
      <RichHtmlField value={{ uz: '<p><b>a</b> <i>b</i></p>' }} onChange={() => {}} />,
    );
    await settle();
    expect(notice(view.container)).toBeNull();
  });

  it('names each language editor "field — language"', async () => {
    const view = render(
      <RichHtmlField name="Umumiy shartlar" value={{ uz: '<p>a</p>' }} onChange={() => {}} />,
    );
    await settle();
    expect(view.container.querySelector('.ProseMirror')?.getAttribute('aria-label')).toBe(
      "Umumiy shartlar — O'zbekcha",
    );
  });
});

describe('second review: links, tab dots, save bar', () => {
  it('typed www.… still autolinks to https', async () => {
    const { editor } = await mount('<p></p>');
    await act(async () => {
      editor.commands.insertContent('see www.mobi.uz ');
    });
    expect(editor.getHTML()).toContain('href="https://www.mobi.uz"');
  });

  it('a pasted relative or ftp link arrives as plain text', async () => {
    const { editor } = await mount();
    await act(async () => {
      editor.view.pasteHTML('<p><a href="/tariffs">Tariflar</a> <a href="ftp://x.uz">ftp</a></p>');
    });
    expect(editor.getHTML()).toBe('<p>Tariflar ftp</p>');
  });

  it('no "modified" dot for a stored table the editor writes differently', async () => {
    const stored = normalizeHtml(
      '<table><tr><td colwidth="100"><p>a</p></td><td colwidth="300"><p>b</p></td></tr></table>',
    );
    const view = render(
      <RichHtmlField value={{ uz: stored }} original={{ uz: stored }} onChange={() => {}} />,
    );
    await settle();
    expect(view.container.querySelector(`[title="O'zgartirilgan (saqlanmagan)"]`)).toBeNull();
  });
});

describe('interface language switch while the editor is open', () => {
  it('updates the placeholder and the accessible name, without a document change', async () => {
    let setLang: (l: string) => void = () => {};
    function Switch() {
      setLang = useLanguage().setLang as (l: string) => void;
      return null;
    }
    const onChange = vi.fn();
    const view = render(
      <LanguageProvider>
        <Switch />
        <TiptapEditor value="" onChange={onChange} />
      </LanguageProvider>,
    );
    await settle();
    const pm = () => view.container.querySelector('.ProseMirror')!;
    expect(pm().querySelector('.is-empty')?.getAttribute('data-placeholder')).toBe(
      'Matn kiriting…',
    );
    expect(pm().getAttribute('aria-label')).toBe('Muharrir');

    await act(async () => setLang('ru'));
    await settle();
    expect(pm().querySelector('.is-empty')?.getAttribute('data-placeholder')).toBe(
      'Введите текст…',
    );
    expect(pm().getAttribute('aria-label')).toBe('Редактор');
    expect(onChange).not.toHaveBeenCalled();
  });
});
