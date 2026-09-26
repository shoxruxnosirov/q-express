import { Check, MapPin, Plus, X } from 'lucide-react';
import { DOM_OPTIONS, XONADON_OPTIONS, formatAddress, type AddressParts } from '@/lib/address';

// Both the profile and checkout pick an address the same way, so the two
// selects and their option lists live in one place.
export function AddressSelects({ value, onChange, idPrefix }: { value: AddressParts; onChange: (parts: AddressParts) => void; idPrefix: string }) {
  const selectClass = 'mt-1.5 h-12 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-sm outline-none focus:border-[hsl(var(--primary))]';
  return <div className="mt-2 grid grid-cols-2 gap-3">
    <label className="block">
      <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">Dom</span>
      <select data-testid={`select-${idPrefix}-dom`} value={value.dom} onChange={event => onChange({ ...value, dom: event.target.value })} className={selectClass}>
        <option value="">Tanlang</option>
        {DOM_OPTIONS.map(option => <option key={option} value={option}>{option}-dom</option>)}
      </select>
    </label>
    <label className="block">
      <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">Xonadon</span>
      <select data-testid={`select-${idPrefix}-xonadon`} value={value.xonadon} onChange={event => onChange({ ...value, xonadon: event.target.value })} className={selectClass}>
        <option value="">Tanlang</option>
        {XONADON_OPTIONS.map(option => <option key={option} value={option}>{option}-xonadon</option>)}
      </select>
    </label>
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
  if (saved.length === 0) return <AddressSelects idPrefix="checkout" value={draft} onChange={onDraft} />;
  const option = (selected: boolean) =>
    `flex w-full items-center gap-3 rounded-xl border p-3.5 text-left text-sm font-bold transition ${selected ? 'border-[hsl(var(--primary))] bg-[#e8efdc] text-[hsl(var(--primary))]' : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]'}`;
  return <div className="mt-2 space-y-2" role="radiogroup" aria-label="Yetkazish manzili">
    {saved.map((address, index) => (
      <button key={`${address.dom}-${address.xonadon}`} type="button" role="radio" aria-checked={choice === index} data-testid={`button-saved-address-${index}`} onClick={() => onChoice(index)} className={option(choice === index)}>
        <MapPin size={16} className="shrink-0" />
        <span className="flex-1">{formatAddress(address)}</span>
        {index === 0 && <span className="rounded-full bg-[hsl(var(--card))] px-2 py-0.5 text-[10px] font-bold text-[hsl(var(--muted-foreground))]">oxirgi</span>}
        {choice === index && <Check size={16} className="shrink-0" />}
      </button>
    ))}
    <button type="button" role="radio" aria-checked={choice === 'new'} data-testid="button-new-address" onClick={() => onChoice('new')} className={option(choice === 'new')}>
      <Plus size={16} className="shrink-0" /><span className="flex-1">Yangi manzil</span>{choice === 'new' && <Check size={16} className="shrink-0" />}
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
  if (addresses.length === 0) {
    return <p className="mt-2 rounded-xl bg-[hsl(var(--muted)/.6)] p-3 text-xs text-[hsl(var(--muted-foreground))]">Hali saqlangan manzil yo‘q. Buyurtma berganingizda manzil o‘zi saqlanadi.</p>;
  }
  return <div className="mt-2 space-y-2">
    {addresses.map((address, index) => (
      <div key={`${address.dom}-${address.xonadon}`} data-testid={`row-saved-address-${index}`} className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] p-3 text-sm">
        <MapPin size={15} className="shrink-0 text-[hsl(var(--primary))]" />
        <span className="flex-1 font-semibold">{formatAddress(address)}</span>
        {index === 0
          ? <span className="rounded-full bg-[#e8efdc] px-2 py-0.5 text-[10px] font-bold text-[hsl(var(--primary))]">asosiy</span>
          : <button type="button" onClick={() => onMakeFirst(address)} className="rounded-full border border-[hsl(var(--border))] px-2 py-0.5 text-[10px] font-bold text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary))]">asosiy qilish</button>}
        <button type="button" aria-label={`${formatAddress(address)} manzilini o‘chirish`} data-testid={`button-remove-address-${index}`} onClick={() => onRemove(address)} className="flex h-7 w-7 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] hover:bg-[#f8e3de] hover:text-[#a64b3f]"><X size={14} /></button>
      </div>
    ))}
  </div>;
}
