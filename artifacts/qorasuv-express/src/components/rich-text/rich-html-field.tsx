import {
  lazy,
  Suspense,
  useDeferredValue,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { inScript, useT } from '@/i18n';
import messages from '@/i18n/messages/richText';
import { htmlEquals, isBlankHtml, sanitizeHtml, splitPage } from '../../lib/rich-html';
import { LANG_NAME_KEY, LangTabs, RICH_LANGS, type MultiLang, type RichLang as Lang } from './lang-tabs';

// The editor and the code view are each their own chunk, loaded only when shown.
function EditorLoading() {
  const { t } = useT(messages);
  return (
    <div
      style={{
        minHeight: '220px',
        border: '1px solid var(--bd)',
        borderRadius: '8px',
        padding: '12px 14px',
        fontSize: '13px',
        color: 'var(--tx5)',
      }}
    >
      {t('loading')}
    </div>
  );
}
const TiptapEditor = lazy(() => import('./tiptap-editor'));
const HtmlSourceEditor = lazy(() => import('./html-source-editor'));

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  // Radio-group keyboard model: one tab stop, arrow keys move and select.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    const next = (i + step + options.length) % options.length;
    onChange(options[next].value);
    const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    buttons[next]?.focus();
  }
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className="pill-tabs">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            className="pill-tab"
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const hint = { fontSize: '12px', color: 'var(--tx4)', lineHeight: 1.45, margin: 0 } as const;

/**
 * One rich-text HTML field in three languages (uz, ru, en — Uzbek Cyrillic is made
 * from uz on display) (the section around it names it). Each language is edited either in
 * the editor ("Text") or as markup ("HTML"); both write the same string. The value
 * is stored unsanitised while editing — the page cleans it on save.
 */
export function RichHtmlField({
  name,
  value,
  original,
  onChange,
}: {
  /** The field's name for screen readers (each language's editor is "name — language"). */
  name?: string;
  value: MultiLang;
  original?: MultiLang;
  onChange: (next: MultiLang) => void;
}) {
  const { t } = useT(messages);
  const [mode, setMode] = useState<'text' | 'html'>('text');
  // Languages whose HTML the editor reshaped on load, so the admin knows to check it.
  const [rewritten, setRewritten] = useState<Partial<Record<Lang, boolean>>>({});

  const setLang = (L: Lang, html: string) => onChange({ ...value, [L]: html });
  const areaLabel = (L: Lang) => `${name ?? t('editor')} — ${t(LANG_NAME_KEY[L])}`;
  // The tab dots use the same comparison as the page's save: equal content written
  // differently (the editor's own markup, table defaults) is not a change.
  // Deferred: with a long text, typing stays smooth and the dots catch up a moment later.
  const deferredValue = useDeferredValue(value);
  const modified = useMemo(
    () =>
      Object.fromEntries(
        RICH_LANGS.map((L) => [L, !htmlEquals(deferredValue[L], original?.[L])]),
      ) as Record<Lang, boolean>,
    [deferredValue, original],
  );

  function renderEditor(L: Lang) {
    const current = value[L] ?? '';
    if (mode === 'html') {
      return (
        <Suspense key={`html-${L}`} fallback={<EditorLoading />}>
          <HtmlSourceEditor
            label={areaLabel(L)}
            value={current}
            onChange={(h) => setLang(L, h)}
          />
        </Suspense>
      );
    }
    return (
      <Suspense key={`text-${L}`} fallback={<EditorLoading />}>
        <TiptapEditor
          lang={L}
          label={areaLabel(L)}
          value={current}
          onChange={(h) => setLang(L, h)}
          // What the editor made of the loaded HTML: store it, so what is saved is what is shown.
          onLoad={(loaded) => {
            // Only a change to the tags or the words counts (see htmlEquals).
            const changed = current !== '' && !htmlEquals(loaded, current);
            // Sticky: after the rewrite is stored, a later load (another language tab and
            // back) compares against the rewritten value and would find nothing to report.
            setRewritten((r) => ({ ...r, [L]: Boolean(r[L]) || changed }));
            if (changed) setLang(L, loaded);
          }}
        />
      </Suspense>
    );
  }

  return (
    <LangTabs
      value={value}
      original={original}
      isModified={(L) => Boolean(modified[L])}
      // One row: the Text / HTML switch on the left, the languages on the right.
      start={
        <Segmented<'text' | 'html'>
          label={t('view')}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'text', label: t('modeText') },
            { value: 'html', label: t('modeHtml') },
          ]}
        />
      }
    >
      {(L) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {renderEditor(L)}
          {mode === 'html' && <p style={hint}>{t('htmlHint')}</p>}
          {mode === 'text' && rewritten[L] && (
            <p role="status" style={{ ...hint, color: 'var(--warn-tx)', fontWeight: 600 }}>
              {t('htmlRewritten')}
            </p>
          )}
        </div>
      )}
    </LangTabs>
  );
}

// Uzbek Cyrillic is the Uzbek (Latin) HTML with its text transliterated — the
// text only: tags, attributes and inline styles stay as they are.
function textToCyrillic(html: string) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    node.nodeValue = inScript(node.nodeValue ?? '', 'uz-Cyrl');
  }
  return template.innerHTML;
}

/**
 * Read-only rendering of the same field, in the reader's language (on the admin
 * pages always Uzbek, see useT). Uzbek Cyrillic shows the Uzbek text transliterated.
 * A language left blank falls back to Uzbek; when Uzbek is blank too it shows "—".
 * The app is rendered in the browser only, so the HTML is cleaned right here.
 */
// `bare` drops the frame, for a shop's card on the storefront, where the card
// is the whole design; an empty value then shows nothing.
export function RichHtmlView({ value, bare = false }: { value?: MultiLang; bare?: boolean }) {
  const { lang } = useT(messages);
  const own = lang === 'uz-Cyrl' ? undefined : value?.[lang];
  let source: Lang = own ? (lang as Lang) : 'uz';
  let raw = own || value?.uz || '';
  // On the storefront a card written in one language only still shows, in
  // that language, rather than as an empty box (hasCard in ShopCards counts
  // a card the same way).
  if (bare && isBlankHtml(raw)) {
    const written = (['uz', 'ru', 'en'] as const).find(code => !isBlankHtml(value?.[code]));
    if (written) {
      source = written;
      raw = value![written]!;
    }
  }
  const clean = sanitizeHtml(raw);
  const html = clean && lang === 'uz-Cyrl' && source === 'uz' ? textToCyrillic(clean) : clean;
  if (!html) {
    if (bare) return null;
    return (
      <span className="rich-scope" style={{ color: 'var(--tx5)', fontSize: '13.5px' }}>
        —
      </span>
    );
  }
  // A page background fills the frame; its own padding keeps the text off the edge.
  const page = Boolean(splitPage(html).page);
  // The frame its text is sized against (rich-text.css): the card's own width.
  return (
    <div className="rich-text-frame">
      <div
        className="rich-text-content"
        lang={lang === 'uz-Cyrl' ? 'uz-Cyrl' : source}
        style={{
          border: bare ? undefined : '1px solid var(--bd)',
          borderRadius: bare ? undefined : '8px',
          // The editor's own padding, so lines wrap as they did while editing.
          padding: page ? 0 : '0.6em',
          overflow: page ? 'hidden' : undefined,
        }}
        // Cleaned by sanitizeHtml (DOMPurify, tag/attribute/URI/CSS allowlists).
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
