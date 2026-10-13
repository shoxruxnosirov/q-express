import { FormEvent, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetStoreStatusQueryKey, getListAdminShopsQueryKey, useGetStoreStatus, useUpdateStoreHours, type StoreStatus } from '@workspace/api-client-react';
import { Clock3, LoaderCircle } from 'lucide-react';
import { apiErrorMessage } from './AdminLogin';
import { useAdminShop, useUnsavedWork } from '@/lib/admin-shop';
import { shopParams } from '@/lib/shop';

// Opening hours and the pause switch, on the dashboard where the person on
// shift will see them.
export function StoreHoursCard() {
  const qc = useQueryClient();
  // The shop the dashboard is working in. Each shop keeps its own hours, set
  // by its own admins or by a Q express super admin acting in it.
  const { acting } = useAdminShop();
  const params = acting && !acting.is_platform ? shopParams(acting.slug) : undefined;
  const statusKey = getGetStoreStatusQueryKey(params);
  // The storefront's status, for whether the shop is open right now. A hidden
  // shop has none (its storefront is gone), so the hours then come from the
  // shop itself and the card still works.
  const status = useGetStoreStatus(params, { query: { queryKey: statusKey, refetchInterval: 60_000, enabled: Boolean(acting?.active), retry: false } });
  const saved: Pick<StoreStatus, 'open_time' | 'close_time' | 'accepting_orders'> & { open_now?: boolean } | undefined =
    status.data ?? (acting ? { open_time: acting.open_time, close_time: acting.close_time, accepting_orders: acting.accepting_orders } : undefined);
  const update = useUpdateStoreHours();
  const [openTime, setOpenTime] = useState('06:00');
  const [closeTime, setCloseTime] = useState('23:00');
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  // Another shop's hours, or new saved ones, replace the form; another shop
  // with the same hours must not keep the previous shop's unsaved edits.
  useEffect(() => {
    if (!saved) return;
    setOpenTime(saved.open_time);
    setCloseTime(saved.close_time);
  }, [acting?.id, saved?.open_time, saved?.close_time]);
  // A message about the previous shop does not belong to this one.
  useEffect(() => setMessage(null), [acting?.id]);
  useUnsavedWork('store-hours', Boolean(saved) && (openTime !== saved?.open_time || closeTime !== saved?.close_time));

  // The hours come from the form; the pause switch keeps the saved hours, so
  // pressing it never also saves times still being edited.
  const save = (hours: { open: string; close: string }, acceptingOrders: boolean, text: string) => {
    update.mutate({ data: { open_time: hours.open, close_time: hours.close, accepting_orders: acceptingOrders } }, {
      onSuccess: next => {
        if (acting?.active) qc.setQueryData(statusKey, next);
        void qc.invalidateQueries({ queryKey: getListAdminShopsQueryKey() });
        setMessage({ text });
      },
      onError: err => setMessage({ text: apiErrorMessage(err, 'Saqlab bo‘lmadi.'), error: true }),
    });
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    save({ open: openTime, close: closeTime }, saved?.accepting_orders ?? true, 'Ish vaqti saqlandi.');
  };

  const data = saved;
  const accepting = data?.accepting_orders ?? true;
  const input = 'mt-1.5 h-11 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-sm outline-none focus:border-[hsl(var(--primary))]';

  return (
    <form onSubmit={submit} data-testid="card-store-hours" className="mb-5 rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Clock3 size={18} className="text-[hsl(var(--primary))]" />
          <p className="text-sm font-extrabold">Ish vaqti</p>
          {data && (
            <span data-testid="badge-store-state" className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${!accepting ? 'bg-[#fdecea] text-[#8c1d18]' : data.open_now ? 'bg-[#e8efdc] text-[hsl(var(--primary))]' : 'bg-[#fff0d4] text-[#a25e08]'}`}>
              {acting?.active === false ? 'Do‘kon mijozlardan yashirilgan' : !accepting ? 'Buyurtmalar to‘xtatilgan' : data.open_now ? 'Hozir ochiq' : 'Hozir yopiq, faqat oldindan buyurtma'}
            </span>
          )}
        </div>
        <button type="button" data-testid="button-toggle-orders" disabled={update.isPending || !data} onClick={() => data && save({ open: data.open_time, close: data.close_time }, !accepting, accepting ? 'Buyurtma qabul qilish to‘xtatildi.' : 'Buyurtma qabul qilish qayta yoqildi.')} className={`rounded-full px-4 py-2 text-xs font-bold disabled:opacity-50 ${accepting ? 'border border-[#e6b2a8] text-[#9d493e]' : 'bg-[hsl(var(--primary))] text-white'}`}>
          {accepting ? 'Buyurtmalarni to‘xtatish' : 'Buyurtmalarni yoqish'}
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <label className="block text-xs font-bold">Ochiladi<input type="time" data-testid="input-open-time" value={openTime} onChange={event => setOpenTime(event.target.value)} required className={input} /></label>
        <label className="block text-xs font-bold">Yopiladi<input type="time" data-testid="input-close-time" value={closeTime} onChange={event => setCloseTime(event.target.value)} required className={input} /></label>
        <button type="submit" data-testid="button-save-hours" disabled={update.isPending} className="col-span-2 flex h-11 items-center justify-center gap-2 rounded-xl sm:col-span-1 bg-[hsl(var(--primary))] px-4 text-xs font-extrabold text-white disabled:opacity-50">
          {update.isPending && <LoaderCircle size={14} className="animate-spin" />} Saqlash
        </button>
      </div>
      {openTime === closeTime && (
        <p data-testid="text-hours-all-day" className="mt-2 rounded-xl bg-[#fff6dc] p-2.5 text-xs font-semibold text-[#7a4f07]">
          Ochilish va yopilish bir xil: do‘kon <b>kun bo‘yi ochiq</b> bo‘ladi. Butunlay yopish uchun «Buyurtmalarni to‘xtatish» tugmasidan foydalaning.
        </p>
      )}
      <p className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">
        Ish vaqtidan tashqarida mijozlar faqat oldindan buyurtma bera oladi, yetkazish vaqti ish vaqti ichidan tanlanadi. Yopilish ochilishdan oldin bo‘lsa (masalan 18:00–02:00), ish vaqti yarim tundan o‘tadi.
      </p>
      {message && <p role="status" className={`mt-2 rounded-xl p-2.5 text-xs font-semibold ${message.error ? 'bg-[#fdf0ed] text-[#9d493e]' : 'bg-[#e8efdc] text-[hsl(var(--primary))]'}`}>{message.text}</p>}
    </form>
  );
}
