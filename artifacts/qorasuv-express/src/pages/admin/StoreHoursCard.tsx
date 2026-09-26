import { FormEvent, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetStoreStatusQueryKey, useGetStoreStatus, useUpdateStoreHours } from '@workspace/api-client-react';
import { Clock3, LoaderCircle } from 'lucide-react';
import { apiErrorMessage } from './AdminLogin';

// Opening hours and the pause switch, on the dashboard where the person on
// shift will see them.
export function StoreHoursCard() {
  const qc = useQueryClient();
  const status = useGetStoreStatus({ query: { queryKey: getGetStoreStatusQueryKey(), refetchInterval: 60_000 } });
  const update = useUpdateStoreHours();
  const [openTime, setOpenTime] = useState('06:00');
  const [closeTime, setCloseTime] = useState('23:00');
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    if (!status.data) return;
    setOpenTime(status.data.open_time);
    setCloseTime(status.data.close_time);
  }, [status.data?.open_time, status.data?.close_time]);

  const save = (acceptingOrders: boolean, text: string) => {
    update.mutate({ data: { open_time: openTime, close_time: closeTime, accepting_orders: acceptingOrders } }, {
      onSuccess: next => { qc.setQueryData(getGetStoreStatusQueryKey(), next); setMessage({ text }); },
      onError: err => setMessage({ text: apiErrorMessage(err, 'Saqlab bo‘lmadi.'), error: true }),
    });
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    save(status.data?.accepting_orders ?? true, 'Ish vaqti saqlandi.');
  };

  const data = status.data;
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
              {!accepting ? 'Buyurtmalar to‘xtatilgan' : data.open_now ? 'Hozir ochiq' : 'Hozir yopiq, faqat oldindan buyurtma'}
            </span>
          )}
        </div>
        <button type="button" data-testid="button-toggle-orders" disabled={update.isPending || !data} onClick={() => save(!accepting, accepting ? 'Buyurtma qabul qilish to‘xtatildi.' : 'Buyurtma qabul qilish qayta yoqildi.')} className={`rounded-full px-4 py-2 text-xs font-bold disabled:opacity-50 ${accepting ? 'border border-[#e6b2a8] text-[#9d493e]' : 'bg-[hsl(var(--primary))] text-white'}`}>
          {accepting ? 'Buyurtmalarni to‘xtatish' : 'Buyurtmalarni yoqish'}
        </button>
      </div>
      <div className="mt-3 grid grid-cols-[1fr_1fr_auto] items-end gap-3">
        <label className="block text-xs font-bold">Ochiladi<input type="time" data-testid="input-open-time" value={openTime} onChange={event => setOpenTime(event.target.value)} required className={input} /></label>
        <label className="block text-xs font-bold">Yopiladi<input type="time" data-testid="input-close-time" value={closeTime} onChange={event => setCloseTime(event.target.value)} required className={input} /></label>
        <button type="submit" data-testid="button-save-hours" disabled={update.isPending} className="flex h-11 items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 text-xs font-extrabold text-white disabled:opacity-50">
          {update.isPending && <LoaderCircle size={14} className="animate-spin" />} Saqlash
        </button>
      </div>
      <p className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">
        Ish vaqtidan tashqarida mijozlar faqat oldindan buyurtma bera oladi, yetkazish vaqti ish vaqti ichidan tanlanadi. Yopilish ochilishdan oldin bo‘lsa (masalan 18:00–02:00), ish vaqti yarim tundan o‘tadi.
      </p>
      {message && <p role="status" className={`mt-2 rounded-xl p-2.5 text-xs font-semibold ${message.error ? 'bg-[#fdf0ed] text-[#9d493e]' : 'bg-[#e8efdc] text-[hsl(var(--primary))]'}`}>{message.text}</p>}
    </form>
  );
}
