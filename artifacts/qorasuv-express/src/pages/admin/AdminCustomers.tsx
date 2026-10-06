import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAdminSessionQueryKey,
  getListAdminCustomersQueryKey,
  useGetAdminSession,
  useBlockCustomer,
  useListAdminCustomers,
  useUnblockCustomer,
  type AdminCustomer,
} from '@workspace/api-client-react';
import { Ban, ChevronDown, MapPin, Search, Send, Smartphone, UserRound } from 'lucide-react';
import { apiErrorMessage } from './AdminLogin';
import { formatAddress } from '@/lib/address';
import { formatUzPhone } from '@/lib/phone';
import { CustomerDevices } from './CustomerDevices';
import { telegramLabel, telegramProfileUrl } from '@/lib/telegram-label';
import { useAsk, useConfirm } from '@/components/ConfirmDialog';

const money = (value: number) => `${Math.round(value).toLocaleString('ru-RU')} so'm`;
const date = (value: string) =>
  new Intl.DateTimeFormat('uz-UZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

// Every customer account, newest order first. A Telegram account is always
// one row; a browser guest may appear more than once if they cleared their
// browser.
export function AdminCustomers() {
  const customers = useListAdminCustomers({ query: { queryKey: getListAdminCustomersQueryKey() } });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'telegram' | 'blocked'>('all');
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  // The one customer whose devices are shown.
  const [openDevices, setOpenDevices] = useState<number | null>(null);
  const qc = useQueryClient();
  // Only a super admin may block or unblock; everyone sees who is blocked.
  const session = useGetAdminSession({ query: { queryKey: getGetAdminSessionQueryKey() } });
  const canBlock = session.data?.admin?.role === 'super_admin';
  const block = useBlockCustomer();
  const unblock = useUnblockCustomer();
  const confirm = useConfirm();
  const ask = useAsk();
  // Replaces the one row in the cached list, so the page need not refetch all.
  const put = (updated: AdminCustomer) =>
    qc.setQueryData<AdminCustomer[]>(getListAdminCustomersQueryKey(), list => list?.map(item => (item.id === updated.id ? updated : item)));
  const blockCustomer = async (customer: AdminCustomer) => {
    const reason = await ask({
      message: `${customer.name || 'Mijoz'} bloklansinmi? U buyurtma bera olmaydi, yoza olmaydi va Telegram orqali kira olmaydi. Blok telefon raqamiga ham qo‘yiladi.`,
      inputLabel: 'Sabab (ixtiyoriy)',
      maxLength: 200,
      confirmLabel: 'Bloklash',
      danger: true,
    });
    if (reason === null) return;
    if (reason.trim().length > 200) {
      setMessage({ text: 'Sabab 200 belgidan oshmasin. Qisqaroq yozib, qaytadan bloklang.', error: true });
      return;
    }
    block.mutate({ id: customer.id, data: { reason: reason.trim() } }, {
      onSuccess: updated => { put(updated); setMessage({ text: `${updated.name || 'Mijoz'} bloklandi.` }); },
      onError: err => setMessage({ text: apiErrorMessage(err, 'Bloklab bo‘lmadi.'), error: true }),
    });
  };
  const unblockCustomer = async (customer: AdminCustomer) => {
    if (!(await confirm({ message: `${customer.name || 'Mijoz'} blokdan chiqarilsinmi?`, confirmLabel: 'Blokdan chiqarish' }))) return;
    unblock.mutate({ id: customer.id }, {
      onSuccess: updated => { put(updated); setMessage({ text: `${updated.name || 'Mijoz'} blokdan chiqarildi.` }); },
      onError: err => setMessage({ text: apiErrorMessage(err, 'Blokdan chiqarib bo‘lmadi.'), error: true }),
    });
  };

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const digits = needle.replace(/\D/g, '');
    return (customers.data ?? []).filter(customer => {
      if (filter === 'telegram' && !customer.telegram_linked) return false;
      if (filter === 'blocked' && !customer.blocked) return false;
      if (!needle) return true;
      return customer.name.toLowerCase().includes(needle) || (digits.length >= 3 && customer.phone.includes(digits));
    });
  }, [customers.data, search, filter]);

  const telegramCount = (customers.data ?? []).filter(customer => customer.telegram_linked).length;
  const blockedCount = (customers.data ?? []).filter(customer => customer.blocked).length;

  return (
    <div className="container-wide py-7 sm:py-10">
      <div className="mb-8">
        <p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Operator workspace / Mijozlar</p>
        <h1 className="display mt-2 text-4xl font-extrabold sm:text-5xl">Mijozlar</h1>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
          Jami {customers.data?.length ?? 0} ta, shundan {telegramCount} tasi Telegram orqali{blockedCount ? `, ${blockedCount} tasi bloklangan` : ''}.
        </p>
      </div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" size={16} />
          <input data-testid="input-customer-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Ism yoki telefon bo‘yicha qidirish" className="h-11 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] pl-11 pr-4 text-sm outline-none focus:border-[hsl(var(--primary))]" />
        </div>
        <select data-testid="select-customer-filter" value={filter} onChange={event => setFilter(event.target.value as typeof filter)} className="h-11 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm font-semibold">
          <option value="all">Hammasi</option>
          <option value="telegram">Faqat Telegram</option>
          <option value="blocked">Faqat bloklanganlar</option>
        </select>
      </div>
      {message && <p role="status" className={`mb-3 rounded-xl p-3 text-sm font-semibold ${message.error ? 'bg-[#fdf0ed] text-[#9d493e]' : 'bg-[#e8efdc] text-[hsl(var(--primary))]'}`}>{message.text}</p>}
      {customers.isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="skeleton h-24 rounded-2xl" />)}</div>
      ) : shown.length === 0 ? (
        <p className="rounded-2xl bg-[hsl(var(--muted)/.6)] p-5 text-sm text-[hsl(var(--muted-foreground))]">Mijoz topilmadi.</p>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {shown.map(customer => (
            <div key={customer.id} data-testid={`row-customer-${customer.id}`} className={`rounded-2xl border p-4 ${customer.blocked ? 'border-[#e6b2a8] bg-[#fdf6f4]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))]'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e8efdc] text-[hsl(var(--primary))]"><UserRound size={17} /></span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-extrabold">{customer.name || 'Ism kiritilmagan'}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                      {customer.phone ? formatUzPhone(customer.phone) : 'Telefon yo‘q'}
                      {customer.telegram_linked && <span className="inline-flex items-center gap-1 rounded-full bg-[#eaf6fc] px-1.5 py-0.5 text-[9px] font-bold text-[#136a93]"><Send size={10} /> Telegram</span>}
                      {customer.blocked && <span data-testid={`badge-blocked-${customer.id}`} className="inline-flex items-center gap-1 rounded-full bg-[#fdecea] px-1.5 py-0.5 text-[9px] font-bold text-[#8c1d18]"><Ban size={10} /> bloklangan</span>}
                    </p>
                    {telegramLabel(customer) && <p data-testid={`text-customer-telegram-${customer.id}`} className="mt-0.5 truncate text-[11px] font-semibold text-[#136a93]">Telegram: {telegramProfileUrl(customer) ? <a href={telegramProfileUrl(customer)} target="_blank" rel="noreferrer" className="underline">{telegramLabel(customer)}</a> : telegramLabel(customer)}</p>}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="display text-lg font-extrabold">{customer.order_count}</p>
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))]">buyurtma</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[hsl(var(--muted-foreground))]">
                <span>Yetkazilgan: <b className="text-[hsl(var(--foreground))]">{money(customer.total_spent)}</b></span>
                <span>Oxirgi buyurtma: {customer.last_order_at ? date(customer.last_order_at) : '—'}</span>
              </div>
              {customer.blocked && (
                <p className="mt-2 text-xs text-[#8c1d18]">
                  {customer.blocked_at ? 'Bloklangan' : `Qurilmasi bloklangan (${customer.blocked_devices} ta) — Telegram akkaunti hamma joyda to‘xtatilgan`}{customer.blocked_by ? `: ${customer.blocked_by}` : ''}{customer.blocked_at ? `, ${date(customer.blocked_at)}` : ''}{customer.block_reason ? `. Sabab: ${customer.block_reason}` : ''}
                </p>
              )}
              <div className="mt-3 flex items-center justify-between gap-2">
                <button type="button" data-testid={`button-devices-${customer.id}`} onClick={() => setOpenDevices(openDevices === customer.id ? null : customer.id)} className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-bold text-[hsl(var(--muted-foreground))]">
                  <Smartphone size={12} /> Qurilmalar ({customer.active_sessions}) <ChevronDown size={12} className={openDevices === customer.id ? 'rotate-180' : ''} />
                </button>
              {canBlock && <div className="flex justify-end">
                {customer.blocked ? (
                  <button type="button" data-testid={`button-unblock-${customer.id}`} onClick={() => unblockCustomer(customer)} disabled={unblock.isPending} className="rounded-full border border-[hsl(var(--primary)/.4)] px-3 py-1.5 text-xs font-bold text-[hsl(var(--primary))] disabled:opacity-50">Blokdan chiqarish</button>
                ) : (
                  <button type="button" data-testid={`button-block-${customer.id}`} onClick={() => blockCustomer(customer)} disabled={block.isPending} className="inline-flex items-center gap-1.5 rounded-full border border-[#e6b2a8] px-3 py-1.5 text-xs font-bold text-[#9d493e] disabled:opacity-50"><Ban size={12} /> Bloklash</button>
                )}
              </div>}
              </div>
              {openDevices === customer.id && <CustomerDevices customerId={customer.id} canBlock={canBlock} />}
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
