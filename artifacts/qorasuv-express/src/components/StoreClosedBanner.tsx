import { Link } from 'wouter';
import { Moon } from 'lucide-react';
import { getGetStoreStatusQueryKey, useGetStoreStatus } from '@workspace/api-client-react';
import { clockTime, dayLabel } from '@/lib/tashkent-time';
import { useT } from '@/i18n';
import messages from '@/i18n/messages/storeClosed';

// A strip under the header while the shop is shut, so nobody fills a cart
// expecting a delivery in fifteen minutes.
// "Откроемся: завтра", not "Завтра": in Russian and English the day sits
// inside a sentence. Uzbek opens the sentence with it, capitalised as written.
function midSentenceFor(lang: string) {
  return (day: string) => (lang === 'ru' || lang === 'en' ? day.charAt(0).toLocaleLowerCase() + day.slice(1) : day);
}

export function StoreClosedBanner() {
  const { t, lang } = useT(messages);
  const midSentence = midSentenceFor(lang);
  const status = useGetStoreStatus({ query: { queryKey: getGetStoreStatusQueryKey(), refetchInterval: 60_000 } });
  const data = status.data;
  if (!data || data.open_now) return null;
  return (
    <div data-testid="banner-store-closed" className="border-b border-[#f0d9a8] bg-[#fff6dc]">
      <div className="container-wide flex items-center gap-2 py-2.5 text-xs font-semibold text-[#7a4f07] sm:text-sm">
        <Moon size={15} className="shrink-0" />
        {data.accepting_orders ? (
          <span>
            {t('closedNow')}{data.next_open_at ? ` ${t('opensAt', { day: midSentence(dayLabel(new Date(data.next_open_at), undefined, lang)), time: clockTime(new Date(data.next_open_at)) })}` : ''} {t('hours', { open: data.open_time, close: data.close_time })}{' '}
            <Link href="/catalog" className="underline underline-offset-2">{t('preorder')}</Link>
          </span>
        ) : (
          <span>{t('paused')}</span>
        )}
      </div>
    </div>
  );
}
