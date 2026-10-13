import { useRef, useState, type ReactNode } from 'react';
import { useT } from '@/i18n';
import messages from '@/i18n/messages/richText';

/**
 * The languages a rich-text value is written in. Uzbek Cyrillic is not one of
 * them: the shop writes Uzbek once, in Latin, and a reader of Cyrillic gets it
 * transliterated (see RichHtmlView).
 */
export type RichLang = 'uz' | 'ru' | 'en';
/** A rich-text value: one HTML string per language, any of them may be missing. */
export type MultiLang = Partial<Record<RichLang, string>>;

export const RICH_LANGS: RichLang[] = ['uz', 'ru', 'en'];

const LANG_NAME_KEY = { uz: 'langUz', ru: 'langRu', en: 'langEn' } as const;

/**
 * Language tabs over a single field (taken over from the admin panel's
 * components/ui/lang-fields.tsx). Click a tab to edit that language; the active
 * tab is highlighted, and a tab whose value differs from `original`
 * (edited/unsaved) shows an amber dot.
 *
 * Pass `label` to render it on the same row as the tab strip (label left,
 * truncated with an ellipsis if it would otherwise collide with the tabs;
 * tabs stay fixed at the row's end and never wrap/shrink) instead of the
 * caller stacking its own `<label>` above `LangTabs`.
 */
export function LangTabs({
  label,
  required,
  value,
  original,
  children,
  langs = RICH_LANGS,
  isModified,
  start,
}: {
  label?: ReactNode;
  required?: boolean;
  value: MultiLang;
  original?: MultiLang;
  children: (lang: RichLang) => ReactNode;
  langs?: RichLang[];
  /**
   * Whether a language differs from `original`, for values where the same content
   * can be written differently (rich-text HTML). Defaults to comparing the strings.
   */
  isModified?: (lang: RichLang) => boolean;
  /**
   * Controls at the start of the tab row, e.g. a Text / HTML switch, so the language
   * tabs sit on its right rather than on a row of their own. On a narrow screen the
   * tabs wrap under it, still to the right.
   */
  start?: ReactNode;
}) {
  const { t } = useT(messages);
  const [active, setActive] = useState<RichLang>(langs[0]);
  const fieldRef = useRef<HTMLDivElement>(null);
  // Picking a tab only swaps which language the field below edits — the caret
  // stays on the tab button, so the admin has to click the field before typing.
  // Hand the field the caret instead, a frame later so it has already
  // re-rendered with the newly selected language.
  const selectLang = (L: RichLang) => {
    setActive(L);
    requestAnimationFrame(() =>
      fieldRef.current
        // A rich-text field has no input: its editor is the contenteditable.
        ?.querySelector<HTMLElement>('input, textarea, [contenteditable="true"]')
        ?.focus(),
    );
  };
  return (
    // rich-scope: the editor's own colour tokens (styles/rich-text.css), kept off the rest of the site.
    <div className="rich-scope" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: label || start ? 'space-between' : 'flex-start',
          gap: '10px',
          ...(start && { flexWrap: 'wrap' }),
        }}
      >
        {start}
        {label && (
          <span
            style={{
              fontSize: '13px',
              fontWeight: 540,
              color: 'var(--tx3)',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
            {required && <span style={{ color: '#dc2626' }}> *</span>}
          </span>
        )}
        <div
          style={{
            display: 'inline-flex',
            gap: '3px',
            background: 'var(--dv)',
            border: '1px solid var(--bd)',
            borderRadius: '9px',
            padding: '3px',
            flexShrink: 0,
            flexWrap: 'wrap',
            ...(start && { marginLeft: 'auto' }),
          }}
        >
          {langs.map((L) => {
            const on = L === active;
            const modified = isModified
              ? isModified(L)
              : (value[L] ?? '') !== (original?.[L] ?? '');
            return (
              <button
                key={L}
                type="button"
                onClick={() => selectLang(L)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12.5px',
                  fontWeight: modified ? 600 : 560,
                  padding: '5px 12px',
                  borderRadius: '7px',
                  border: 'none',
                  cursor: 'pointer',
                  color: on ? 'var(--tx)' : modified ? 'var(--warn-tx)' : 'var(--tx4)',
                  background: on ? 'var(--sf)' : 'transparent',
                  boxShadow: on ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                }}
              >
                {t(LANG_NAME_KEY[L])}
                {modified && (
                  <span
                    title={t('modifiedUnsaved')}
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '999px',
                      background: '#f59e0b',
                      flexShrink: 0,
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
      {/* display:contents so the wrapper only exists to scope the focus lookup
          — the field stays the same flex item of this column that it was. */}
      <div ref={fieldRef} style={{ display: 'contents' }}>
        {children(active)}
      </div>
    </div>
  );
}

export { LANG_NAME_KEY };
