import { Link } from 'wouter';
import { Moon } from 'lucide-react';
import { getGetStoreStatusQueryKey, useGetStoreStatus } from '@workspace/api-client-react';
import { clockTime, dayLabel } from '@/lib/tashkent-time';

// A strip under the header while the shop is shut, so nobody fills a cart
// expecting a delivery in fifteen minutes.
export function StoreClosedBanner() {
  const status = useGetStoreStatus({ query: { queryKey: getGetStoreStatusQueryKey(), refetchInterval: 60_000 } });
  const data = status.data;
  if (!data || data.open_now) return null;
  return (
    <div data-testid="banner-store-closed" className="border-b border-[#f0d9a8] bg-[#fff6dc]">
      <div className="container-wide flex items-center gap-2 py-2.5 text-xs font-semibold text-[#7a4f07] sm:text-sm">
        <Moon size={15} className="shrink-0" />
        {data.accepting_orders ? (
          <span>
            Hozir yopiqmiz.{data.next_open_at ? ` ${dayLabel(new Date(data.next_open_at))} soat ${clockTime(new Date(data.next_open_at))} da ochilamiz.` : ''} Ish vaqti {data.open_time}–{data.close_time}.{' '}
            <Link href="/catalog" className="underline underline-offset-2">Oldindan buyurtma bering</Link>
          </span>
        ) : (
          <span>Hozir buyurtma qabul qilinmayapti. Birozdan keyin qayta urinib ko‘ring.</span>
        )}
      </div>
    </div>
  );
}
