import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, Check, Info, RefreshCw, Zap } from 'lucide-react';
import type { StoreStatus } from '@workspace/api-client-react';
import { clockTime, deliveryLabel, groupSlotsByDay } from '@/lib/tashkent-time';
import { useT } from '@/i18n';
import messages from '@/i18n/messages/deliveryTime';
import { offeredSlots, reconcileChoice, stillAccepted as acceptedBy, type DeliveryChoice } from '@/lib/delivery-choice';

export type { DeliveryChoice };

// "Hozir" while the shop is open; otherwise, or by choice, a pre-order for a
// slot inside the opening hours. The server checks the same rules.
export function DeliveryTime({ status, failed, onRetry, value, onChange }: {
  status: StoreStatus | undefined;
  failed: boolean;
  onRetry: () => void;
  value: DeliveryChoice;
  onChange: (choice: DeliveryChoice) => void;
}) {
  const { t, lang } = useT(messages);
  const openNow = Boolean(status?.open_now);
  // Set when the chosen time ran out and another was picked, so the change
  // is said out loud rather than made silently. Cleared by any choice.
  const [notice, setNotice] = useState('');
  // Whether the shop was open at the previous refresh, to tell "it closed
  // while you were here" from "it was already closed".
  const wasOpen = useRef(false);
  const choose = (choice: DeliveryChoice) => { setNotice(''); onChange(choice); };

  // A chosen time stays put while the server would still take it, even after
  // the minute-by-minute refresh drops it from the list (lib/delivery-choice).
  const stillAccepted = (slot: string) => Boolean(status && acceptedBy(status, slot));
  const offered = useMemo(() => (status ? offeredSlots(status, value) : []), [status, value]);
  const days = useMemo(() => groupSlotsByDay(offered, undefined, lang), [offered, lang]);

  useEffect(() => {
    if (!status) return;
    const { next, change } = reconcileChoice(status, value, wasOpen.current);
    wasOpen.current = status.open_now;
    if (change?.reason === 'closed') {
      setNotice(t('closedMoved', { when: deliveryLabel(new Date(next.slot), undefined, lang) }));
    } else if (change?.reason === 'expired') {
      setNotice(t('expiredMoved', { from: deliveryLabel(new Date(change.from), undefined, lang), when: deliveryLabel(new Date(next.slot), undefined, lang) }));
    }
    // Only a real change is reported, or an empty slot list would loop.
    if (next.mode !== value.mode || next.slot !== value.slot) onChange(next);
  }, [status, value, onChange, t, lang]);

  if (!status) {
    if (failed) {
      return (
        <div data-testid="text-status-failed" className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-[#fdf0ed] p-3 text-sm font-semibold text-[#9d493e]">
          <span>{t('loadFailed')}</span>
          <button type="button" onClick={onRetry} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-bold"><RefreshCw size={13} /> {t('retry')}</button>
        </div>
      );
    }
    return <div className="mt-3 skeleton h-24 rounded-xl" />;
  }
  if (!status.accepting_orders) {
    return <p data-testid="text-orders-paused" className="mt-3 rounded-xl bg-[#fdf0ed] p-3 text-sm font-semibold text-[#9d493e]">{t('paused')}</p>;
  }

  const selectedDay = days.find(day => day.slots.includes(value.slot)) ?? days[0];
  const option = (active: boolean, disabled = false) =>
    `flex flex-1 items-center gap-3 rounded-xl border p-3.5 text-left text-sm font-bold transition ${disabled ? 'cursor-not-allowed opacity-50' : ''} ${active ? 'border-[hsl(var(--primary))] bg-[#e8efdc] text-[hsl(var(--primary))]' : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]'}`;
  const selectClass = 'mt-1.5 h-12 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-sm outline-none focus:border-[hsl(var(--primary))]';

  return (
    <div className="mt-3 space-y-2">
      {!openNow && (
        <p data-testid="text-store-closed" className="rounded-xl bg-[#fff6dc] p-3 text-xs font-semibold text-[#7a4f07]">
          {t('closedNow', { open: status.open_time, close: status.close_time })}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" data-testid="button-deliver-now" disabled={!openNow} onClick={() => choose({ ...value, mode: 'now' })} className={option(value.mode === 'now', !openNow)}>
          <Zap size={16} className="shrink-0" /><span className="flex-1">{t('now')}<span className="block text-[11px] font-semibold opacity-80">{t('nowHint')}</span></span>{value.mode === 'now' && <Check size={16} />}
        </button>
        <button type="button" data-testid="button-deliver-later" disabled={days.length === 0} onClick={() => choose({ mode: 'later', slot: stillAccepted(value.slot) ? value.slot : days[0]?.slots[0] ?? '' })} className={option(value.mode === 'later', days.length === 0)}>
          <CalendarClock size={16} className="shrink-0" /><span className="flex-1">{t('later')}<span className="block text-[11px] font-semibold opacity-80">{value.mode === 'later' && value.slot ? deliveryLabel(new Date(value.slot), undefined, lang) : t('pickDayTime')}</span></span>{value.mode === 'later' && <Check size={16} />}
        </button>
      </div>
      {value.mode === 'later' && selectedDay && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">{t('day')}</span>
            <select data-testid="select-delivery-day" value={selectedDay.key} onChange={event => { const day = days.find(d => d.key === Number(event.target.value)); if (day) choose({ mode: 'later', slot: day.slots[0] }); }} className={selectClass}>
              {days.map(day => <option key={day.key} value={day.key}>{day.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">{t('time')}</span>
            <select data-testid="select-delivery-time" value={value.slot} onChange={event => choose({ mode: 'later', slot: event.target.value })} className={selectClass}>
              {selectedDay.slots.map(slot => <option key={slot} value={slot}>{clockTime(new Date(slot))}</option>)}
            </select>
          </label>
        </div>
      )}
      {notice && (
        <p data-testid="text-slot-moved" role="status" className="flex items-start gap-2 rounded-xl bg-[#fff6dc] p-3 text-xs font-semibold text-[#7a4f07]">
          <Info size={14} className="mt-0.5 shrink-0" />{notice}
        </p>
      )}
    </div>
  );
}
