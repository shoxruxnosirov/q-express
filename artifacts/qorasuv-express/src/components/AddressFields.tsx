import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, MapPin, Plus, Search, X } from 'lucide-react';
import { DOM_OPTIONS, XONADON_OPTIONS, matchOptions, type AddressParts } from '@/lib/address';
import { useT } from '@/i18n';
import messages from '@/i18n/messages/addressFields';

// The address as the customer reads it, in their language. The order itself
// carries formatAddress's Uzbek line (lib/address) for the shop.
function useAddressLine() {
  const { t } = useT(messages);
  return (address: AddressParts) => t('line', { dom: address.dom, xonadon: address.xonadon });
}

// A native select of 200 buildings is a long scroll on a phone. Tapping this
// opens a panel instead: a search box to type the number into, and the
// numbers in a grid, so even without typing the list is short.
function SearchableSelect({ testId, label, value, options, optionLabel, onChange }: {
  testId: string;
  label: string;
  value: string;
  options: readonly string[];
  optionLabel: (option: string) => string;
  onChange: (value: string) => void;
}) {
  const { t } = useT(messages);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const button = useRef<HTMLButtonElement>(null);
  const chosen = useRef<HTMLButtonElement>(null);
  const shown = useMemo(() => matchOptions(options, query), [options, query]);
  const numeric = useMemo(() => options.every(option => /^\d+$/.test(option)), [options]);

  const close = () => {
    setOpen(false);
    setQuery('');
    button.current?.focus();
  };
  const pick = (option: string) => {
    onChange(option);
    close();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    // The number already chosen (say 150) is shown, not left below the fold.
    chosen.current?.scrollIntoView({ block: 'center' });
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return <div className="block">
    <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">{label}</span>
    <button
      ref={button}
      type="button"
      data-testid={testId}
      aria-label={`${label}: ${value ? optionLabel(value) : t('choose')}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => setOpen(true)}
      className={`mt-1.5 flex h-12 w-full items-center justify-between gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-left text-sm outline-none focus:border-[hsl(var(--primary))] ${value ? 'font-semibold' : 'text-[hsl(var(--muted-foreground))]'}`}
    >
      <span className="truncate">{value ? optionLabel(value) : t('choose')}</span>
      <ChevronDown size={16} className="shrink-0 text-[hsl(var(--muted-foreground))]" />
    </button>
    {open && createPortal(<div className="fixed inset-0 z-[60] flex items-start justify-center bg-[hsl(var(--foreground)/.4)] p-3 backdrop-blur-sm sm:items-center" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="flex max-h-[calc(100vh-1.5rem)] supports-[height:100dvh]:max-h-[calc(100dvh-1.5rem)] w-full max-w-md flex-col rounded-[20px] bg-[hsl(var(--card))] p-4 shadow-2xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="display text-lg font-bold">{label}</h3>
          <button type="button" aria-label={t('close')} onClick={close} className="rounded-full p-2 transition hover:bg-[hsl(var(--muted))]"><X size={18} /></button>
        </div>
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
          <input
            autoFocus
            data-testid={`${testId}-search`}
            type="text"
            inputMode={numeric ? 'numeric' : 'text'}
            enterKeyHint="done"
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              // Enter takes the first match, so typing "57" and Enter is enough.
              if (event.key === 'Enter' && shown.length > 0) {
                event.preventDefault();
                pick(shown[0]);
              }
            }}
            placeholder={t('search')}
            aria-label={t('search')}
            className="h-12 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] pl-9 pr-3 text-base outline-none focus:border-[hsl(var(--primary))]"
          />
        </div>
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {shown.length === 0
            ? <p className="py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">{t('notFound')}</p>
            : <div role="listbox" aria-label={label} className="grid grid-cols-5 gap-2">
              {shown.map(option => <button
                key={option}
                ref={option === value ? chosen : undefined}
                type="button"
                role="option"
                aria-selected={option === value}
                aria-label={optionLabel(option)}
                data-testid={`${testId}-option-${option}`}
                onClick={() => pick(option)}
                className={`tap h-11 rounded-xl border text-sm font-bold transition ${option === value ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-white' : 'border-[hsl(var(--border))] bg-[hsl(var(--background))] hover:border-[hsl(var(--primary))]'}`}
              >{option}</button>)}
            </div>}
        </div>
      </div>
    </div>, document.body)}
  </div>;
}

// Both the profile and checkout pick an address the same way, so the two
// pickers and their option lists live in one place.
export function AddressSelects({ value, onChange, idPrefix }: { value: AddressParts; onChange: (parts: AddressParts) => void; idPrefix: string }) {
  const { t } = useT(messages);
  return <div className="mt-2 grid grid-cols-2 gap-3">
    <SearchableSelect
      testId={`select-${idPrefix}-dom`}
      label={t('dom')}
      value={value.dom}
      options={DOM_OPTIONS}
      optionLabel={option => t('domOption', { n: option })}
      onChange={dom => onChange({ ...value, dom })}
    />
    <SearchableSelect
      testId={`select-${idPrefix}-xonadon`}
      label={t('xonadon')}
      value={value.xonadon}
      options={XONADON_OPTIONS}
      optionLabel={option => t('xonadonOption', { n: option })}
      onChange={xonadon => onChange({ ...value, xonadon })}
    />
  </div>;
}

export type AddressChoice = number | 'new';

// Checkout: pick one of the saved addresses, or enter a new one. With nothing
// saved yet it is just the two selects.
export function AddressPicker({ saved, choice, onChoice, draft, onDraft }: {
  saved: readonly AddressParts[];
  choice: AddressChoice;
  onChoice: (choice: AddressChoice) => void;
  draft: AddressParts;
  onDraft: (parts: AddressParts) => void;
}) {
  const { t } = useT(messages);
  const addressLine = useAddressLine();
  if (saved.length === 0) return <AddressSelects idPrefix="checkout" value={draft} onChange={onDraft} />;
  const option = (selected: boolean) =>
    `flex w-full items-center gap-3 rounded-xl border p-3.5 text-left text-sm font-bold transition ${selected ? 'border-[hsl(var(--primary))] bg-[#e8efdc] text-[hsl(var(--primary))]' : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]'}`;
  return <div className="mt-2 space-y-2" role="radiogroup" aria-label={t('addressGroup')}>
    {saved.map((address, index) => (
      <button key={`${address.dom}-${address.xonadon}`} type="button" role="radio" aria-checked={choice === index} data-testid={`button-saved-address-${index}`} onClick={() => onChoice(index)} className={option(choice === index)}>
        <MapPin size={16} className="shrink-0" />
        <span className="flex-1">{addressLine(address)}</span>
        {index === 0 && <span className="rounded-full bg-[hsl(var(--card))] px-2 py-0.5 text-[10px] font-bold text-[hsl(var(--muted-foreground))]">{t('last')}</span>}
        {choice === index && <Check size={16} className="shrink-0" />}
      </button>
    ))}
    <button type="button" role="radio" aria-checked={choice === 'new'} data-testid="button-new-address" onClick={() => onChoice('new')} className={option(choice === 'new')}>
      <Plus size={16} className="shrink-0" /><span className="flex-1">{t('newAddress')}</span>{choice === 'new' && <Check size={16} className="shrink-0" />}
    </button>
    {choice === 'new' && <AddressSelects idPrefix="checkout" value={draft} onChange={onDraft} />}
  </div>;
}

// Profile: the saved addresses, each removable, the first marked as the one
// checkout will preselect.
export function SavedAddressList({ addresses, onRemove, onMakeFirst }: {
  addresses: readonly AddressParts[];
  onRemove: (address: AddressParts) => void;
  onMakeFirst: (address: AddressParts) => void;
}) {
  const { t } = useT(messages);
  const addressLine = useAddressLine();
  if (addresses.length === 0) {
    return <p className="mt-2 rounded-xl bg-[hsl(var(--muted)/.6)] p-3 text-xs text-[hsl(var(--muted-foreground))]">{t('noneSaved')}</p>;
  }
  return <div className="mt-2 space-y-2">
    {addresses.map((address, index) => (
      <div key={`${address.dom}-${address.xonadon}`} data-testid={`row-saved-address-${index}`} className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] p-3 text-sm">
        <MapPin size={15} className="shrink-0 text-[hsl(var(--primary))]" />
        <span className="flex-1 font-semibold">{addressLine(address)}</span>
        {index === 0
          ? <span className="rounded-full bg-[#e8efdc] px-2 py-0.5 text-[10px] font-bold text-[hsl(var(--primary))]">{t('main')}</span>
          : <button type="button" onClick={() => onMakeFirst(address)} className="rounded-full border border-[hsl(var(--border))] px-2 py-0.5 text-[10px] font-bold text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary))]">{t('makeMain')}</button>}
        <button type="button" aria-label={t('remove', { address: addressLine(address) })} data-testid={`button-remove-address-${index}`} onClick={() => onRemove(address)} className="flex h-7 w-7 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] hover:bg-[#f8e3de] hover:text-[#a64b3f]"><X size={14} /></button>
      </div>
    ))}
  </div>;
}
