import { useEffect, useMemo } from 'react';
import { CalendarClock, Check, Zap } from 'lucide-react';
import type { StoreStatus } from '@workspace/api-client-react';
import { clockTime, deliveryLabel, groupSlotsByDay } from '@/lib/tashkent-time';

export type DeliveryChoice = { mode: 'now' | 'later'; slot: string };

// "Hozir" while the shop is open; otherwise, or by choice, a pre-order for a
// slot inside the opening hours. The server checks the same rules.
export function DeliveryTime({ status, value, onChange }: {
  status: StoreStatus | undefined;
  value: DeliveryChoice;
  onChange: (choice: DeliveryChoice) => void;
}) {
  const days = useMemo(() => groupSlotsByDay(status?.slots ?? []), [status?.slots]);
  const openNow = Boolean(status?.open_now);

  // Closed now: only pre-orders are possible, so switch to them. A chosen slot
  // that is no longer offered (time moved on) falls back to the first one.
  useEffect(() => {
    if (!status) return;
    const offered = status.slots.includes(value.slot);
    const firstSlot = status.slots[0] ?? '';
    let next = value;
    if (!openNow && value.mode === 'now') next = { mode: 'later', slot: offered ? value.slot : firstSlot };
    else if (value.mode === 'later' && !offered) next = { mode: 'later', slot: firstSlot };
    // Only a real change is reported, or an empty slot list would loop.
    if (next.mode !== value.mode || next.slot !== value.slot) onChange(next);
  }, [status, openNow, value, onChange]);

  if (!status) return <div className="mt-3 skeleton h-24 rounded-xl" />;
  if (!status.accepting_orders) {
    return <p data-testid="text-orders-paused" className="mt-3 rounded-xl bg-[#fdf0ed] p-3 text-sm font-semibold text-[#9d493e]">Hozir buyurtma qabul qilinmayapti. Birozdan keyin qayta urinib ko‘ring.</p>;
  }

  const selectedDay = days.find(day => day.slots.includes(value.slot)) ?? days[0];
  const option = (active: boolean, disabled = false) =>
    `flex flex-1 items-center gap-3 rounded-xl border p-3.5 text-left text-sm font-bold transition ${disabled ? 'cursor-not-allowed opacity-50' : ''} ${active ? 'border-[hsl(var(--primary))] bg-[#e8efdc] text-[hsl(var(--primary))]' : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]'}`;
  const selectClass = 'mt-1.5 h-12 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-sm outline-none focus:border-[hsl(var(--primary))]';

  return (
    <div className="mt-3 space-y-2">
      {!openNow && (
        <p data-testid="text-store-closed" className="rounded-xl bg-[#fff6dc] p-3 text-xs font-semibold text-[#7a4f07]">
          Do‘kon hozir yopiq. Ish vaqti {status.open_time}–{status.close_time}. Yetkazish vaqtini tanlab, oldindan buyurtma bering.
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" data-testid="button-deliver-now" disabled={!openNow} onClick={() => onChange({ ...value, mode: 'now' })} className={option(value.mode === 'now', !openNow)}>
          <Zap size={16} className="shrink-0" /><span className="flex-1">Hozir<span className="block text-[11px] font-semibold opacity-80">15–19 daqiqada</span></span>{value.mode === 'now' && <Check size={16} />}
        </button>
        <button type="button" data-testid="button-deliver-later" disabled={days.length === 0} onClick={() => onChange({ mode: 'later', slot: value.slot || days[0]?.slots[0] || '' })} className={option(value.mode === 'later', days.length === 0)}>
          <CalendarClock size={16} className="shrink-0" /><span className="flex-1">Oldindan buyurtma<span className="block text-[11px] font-semibold opacity-80">{value.mode === 'later' && value.slot ? deliveryLabel(new Date(value.slot)) : 'Kun va vaqtni tanlang'}</span></span>{value.mode === 'later' && <Check size={16} />}
        </button>
      </div>
      {value.mode === 'later' && selectedDay && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">Kun</span>
            <select data-testid="select-delivery-day" value={selectedDay.key} onChange={event => { const day = days.find(d => d.key === Number(event.target.value)); if (day) onChange({ mode: 'later', slot: day.slots[0] }); }} className={selectClass}>
              {days.map(day => <option key={day.key} value={day.key}>{day.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">Vaqt</span>
            <select data-testid="select-delivery-time" value={value.slot} onChange={event => onChange({ mode: 'later', slot: event.target.value })} className={selectClass}>
              {selectedDay.slots.map(slot => <option key={slot} value={slot}>{clockTime(new Date(slot))}</option>)}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
