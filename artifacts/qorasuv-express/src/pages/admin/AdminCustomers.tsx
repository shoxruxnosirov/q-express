import { useMemo, useState } from 'react';
import { getListAdminCustomersQueryKey, useListAdminCustomers } from '@workspace/api-client-react';
import { BadgeCheck, MapPin, Search, UserRound } from 'lucide-react';
import { formatAddress } from '@/lib/address';
import { formatUzPhone } from '@/lib/phone';

const money = (value: number) => `${Math.round(value).toLocaleString('ru-RU')} so'm`;
const date = (value: string) =>
  new Intl.DateTimeFormat('uz-UZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

// Every customer account, newest order first. A customer who never verified
// may appear more than once if they cleared their browser; a verified phone is
// always one row.
export function AdminCustomers() {
  const customers = useListAdminCustomers({ query: { queryKey: getListAdminCustomersQueryKey() } });
  const [search, setSearch] = useState('');
  const [onlyVerified, setOnlyVerified] = useState(false);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const digits = needle.replace(/\D/g, '');
    return (customers.data ?? []).filter(customer => {
      if (onlyVerified && !customer.phone_verified) return false;
      if (!needle) return true;
      return customer.name.toLowerCase().includes(needle) || (digits.length >= 3 && customer.phone.includes(digits));
    });
  }, [customers.data, search, onlyVerified]);

  const verifiedCount = (customers.data ?? []).filter(customer => customer.phone_verified).length;

  return (
    <div className="container-wide py-7 sm:py-10">
      <div className="mb-8">
        <p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Operator workspace / Mijozlar</p>
        <h1 className="display mt-2 text-4xl font-extrabold sm:text-5xl">Mijozlar</h1>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
          Jami {customers.data?.length ?? 0} ta, shundan {verifiedCount} tasi Telegram orqali tasdiqlangan.
        </p>
      </div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" size={16} />
          <input data-testid="input-customer-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Ism yoki telefon bo‘yicha qidirish" className="h-11 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] pl-11 pr-4 text-sm outline-none focus:border-[hsl(var(--primary))]" />
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={onlyVerified} onChange={event => setOnlyVerified(event.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
          Faqat tasdiqlanganlar
        </label>
      </div>
      {customers.isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="skeleton h-24 rounded-2xl" />)}</div>
      ) : shown.length === 0 ? (
        <p className="rounded-2xl bg-[hsl(var(--muted)/.6)] p-5 text-sm text-[hsl(var(--muted-foreground))]">Mijoz topilmadi.</p>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {shown.map(customer => (
            <div key={customer.id} data-testid={`row-customer-${customer.id}`} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e8efdc] text-[hsl(var(--primary))]"><UserRound size={17} /></span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-extrabold">{customer.name || 'Ism kiritilmagan'}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                      {customer.phone ? formatUzPhone(customer.phone) : 'Telefon yo‘q'}
                      {customer.phone_verified && <span className="inline-flex items-center gap-1 rounded-full bg-[#e8efdc] px-1.5 py-0.5 text-[9px] font-bold text-[hsl(var(--primary))]"><BadgeCheck size={10} /> tasdiqlangan</span>}
                    </p>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="display text-lg font-extrabold">{customer.order_count}</p>
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))]">buyurtma</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[hsl(var(--muted-foreground))]">
                <span>Jami: <b className="text-[hsl(var(--foreground))]">{money(customer.total_spent)}</b></span>
                <span>Oxirgi buyurtma: {customer.last_order_at ? date(customer.last_order_at) : '—'}</span>
              </div>
              {customer.addresses.length > 0 && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                  <MapPin size={13} className="mt-0.5 shrink-0 text-[hsl(var(--primary))]" />
                  {customer.addresses.map(address => formatAddress(address)).join(' · ')}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
