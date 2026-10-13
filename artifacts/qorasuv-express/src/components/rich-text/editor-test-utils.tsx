/**
 * Helpers for the editor's jsdom tests: mount the real editor, drive it through
 * its UI, and check that what it produces survives save, display and reload.
 */
import { expect } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import TiptapEditor, { editorHtml } from './tiptap-editor';
import { normalizeHtml, sanitizeHtml } from '../../lib/rich-html';

// jsdom has no ClipboardEvent (ProseMirror's pasteText/pasteHTML build one) and no
// layout (ProseMirror measures ranges when it scrolls the caret into view).
(globalThis as unknown as { ClipboardEvent: unknown }).ClipboardEvent ??= class extends Event {
  clipboardData = null;
};
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

export const settle = () =>
  act(async () => {
    // Past the next animation frame: Tiptap hands focus back to the text on one.
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  });

export async function mount(value = '') {
  const view = render(<TiptapEditor value={value} onChange={() => {}} />);
  await settle();
  const editor = (view.container.querySelector('.ProseMirror') as unknown as { editor: Editor })
    .editor;
  const q = <T extends HTMLElement = HTMLElement>(sel: string) =>
    view.container.querySelector<T>(sel);
  const button = (label: string) => {
    const el = q<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!el) throw new Error(`no button "${label}"`);
    return el;
  };
  const click = async (label: string) => {
    await act(async () => fireEvent.click(button(label)));
    await settle();
  };
  const pick = async (text: string) => {
    const item = Array.from(view.container.querySelectorAll('[role=menu] button')).find(
      (b) => b.textContent?.trim() === text,
    );
    if (!item) throw new Error(`no menu item "${text}"`);
    await act(async () => fireEvent.click(item));
    await settle();
  };
  const run = async (fn: () => void) => {
    await act(async () => fn());
    await settle();
  };
  /** Shown as on / active: pressed toggles and popup buttons for a non-default value. */
  const isOn = (label: string) => button(label).hasAttribute('data-active');
  const isDisabled = (label: string) => button(label).disabled;
  const select = (from: number, to = from) =>
    run(() => editor.commands.setTextSelection({ from, to }));
  const selectAll = () => select(1, editor.state.doc.content.size - 1);
  const cellPopup = async (pos: number) => {
    await run(() => {
      editor.commands.setTextSelection(pos);
      fireEvent.keyDown(editor.view.dom, { key: 'F10', altKey: true });
    });
  };
  /** Positions (before the node) of every table cell, in document order. */
  const cells = () => {
    const out: number[] = [];
    editor.state.doc.descendants((n, pos) => {
      if (n.type.name === 'tableCell' || n.type.name === 'tableHeader') out.push(pos);
    });
    return out;
  };
  return {
    ...view,
    editor,
    q,
    button,
    click,
    pick,
    run,
    isOn,
    isDisabled,
    select,
    selectAll,
    cellPopup,
    cells,
  };
}

export type Mounted = Awaited<ReturnType<typeof mount>>;

/** Save, show and reload; returns the stored HTML after checking all three agree. */
export async function roundTrip(editor: Editor): Promise<string> {
  const stored = normalizeHtml(editorHtml(editor));
  // The read view shows exactly what was stored.
  expect(sanitizeHtml(stored)).toBe(stored);
  // Saving again changes nothing.
  expect(normalizeHtml(stored)).toBe(stored);
  // A fresh editor loads it back to the same stored form.
  let loaded = '';
  const again = render(
    <TiptapEditor value={stored} onChange={() => {}} onLoad={(h) => (loaded = h)} />,
  );
  await settle();
  expect(normalizeHtml(loaded)).toBe(stored);
  again.unmount();
  return stored;
}

/** The stored form of the editor's content right now (as onChange hands it on, then saved). */
export const saved = (editor: Editor) => normalizeHtml(editorHtml(editor));
