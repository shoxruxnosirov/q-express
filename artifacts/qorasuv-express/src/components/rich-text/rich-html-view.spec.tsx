/**
 * What this shop's RichHtmlView does beyond the admin panel's: a blank language
 * falls back to Uzbek, and Uzbek Cyrillic shows the Uzbek text transliterated
 * (text only — tags, attributes and styles stay as written).
 */
import { describe, it, expect } from 'vitest';
import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { LanguageProvider, useLanguage, type Lang } from '@/i18n';
import { RichHtmlView } from './rich-html-field';
import type { MultiLang } from './lang-tabs';

function InLang({ lang, value }: { lang: Lang; value: MultiLang }) {
  const { setLang } = useLanguage();
  useEffect(() => setLang(lang), [lang, setLang]);
  return <RichHtmlView value={value} />;
}

function BareInLang({ lang, value }: { lang: Lang; value: MultiLang }) {
  const { setLang } = useLanguage();
  useEffect(() => setLang(lang), [lang, setLang]);
  return <RichHtmlView value={value} bare />;
}

async function show(lang: Lang, value: MultiLang) {
  const view = render(
    <LanguageProvider>
      <InLang lang={lang} value={value} />
    </LanguageProvider>,
  );
  await act(async () => {});
  return view;
}

describe('RichHtmlView in the shop languages', () => {
  it('shows the reader’s own language when it is written', async () => {
    const view = await show('ru', { uz: '<p>olma</p>', ru: '<p>яблоко</p>' });
    expect(view.container.textContent).toBe('яблоко');
    expect(view.container.querySelector('.rich-text-content')?.getAttribute('lang')).toBe('ru');
  });

  it('falls back to Uzbek when the reader’s language is blank', async () => {
    const view = await show('en', { uz: '<p>olma</p>', en: '' });
    expect(view.container.textContent).toBe('olma');
    expect(view.container.querySelector('.rich-text-content')?.getAttribute('lang')).toBe('uz');
  });

  it('shows "—" when Uzbek is blank too', async () => {
    const view = await show('en', { ru: '<p>яблоко</p>' });
    expect(view.container.textContent).toBe('—');
  });

  it('shows a storefront card in the one language it is written in', async () => {
    const view = render(
      <LanguageProvider>
        <BareInLang lang="en" value={{ ru: '<p>яблоко</p>', uz: '<p> </p>' }} />
      </LanguageProvider>,
    );
    await act(async () => {});
    expect(view.container.textContent).toBe('яблоко');
    expect(view.container.querySelector('.rich-text-content')?.getAttribute('lang')).toBe('ru');
    view.unmount();
    // Uzbek Cyrillic falls back the same way; Russian text is not transliterated.
    const cyrl = render(
      <LanguageProvider>
        <BareInLang lang="uz-Cyrl" value={{ en: '<p>apple</p>' }} />
      </LanguageProvider>,
    );
    await act(async () => {});
    expect(cyrl.container.textContent).toBe('apple');
  });

  it('transliterates the Uzbek text for Uzbek Cyrillic, leaving the markup alone', async () => {
    const view = await show('uz-Cyrl', {
      uz: '<p><strong>Shirin</strong> olma <a href="https://shop.uz/olma">bu yerda</a></p>',
    });
    const content = view.container.querySelector('.rich-text-content')!;
    expect(content.getAttribute('lang')).toBe('uz-Cyrl');
    expect(content.textContent).toBe('Ширин олма бу ерда');
    expect(content.querySelector('strong')?.textContent).toBe('Ширин');
    expect(content.querySelector('a')?.getAttribute('href')).toBe('https://shop.uz/olma');
  });
});
