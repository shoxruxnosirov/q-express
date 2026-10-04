import { getGetCustomerLoginLinkQueryKey, useGetCustomerLoginLink } from '@workspace/api-client-react';
import { Send } from 'lucide-react';
import { isMiniApp } from '@/lib/telegram-mini-app';

// The shop lives in Telegram: there the customer is signed in by their
// Telegram account, with their profile, orders and the chat that the bot
// shares. A browser outside Telegram orders as a guest and is offered the way
// in. Inside the Mini App there is nothing to show.
export function OpenInTelegram({ title, hint }: { title: string; hint: string }) {
  const link = useGetCustomerLoginLink({
    query: { queryKey: getGetCustomerLoginLinkQueryKey(), staleTime: Infinity, retry: false, enabled: !isMiniApp() },
  });
  if (isMiniApp() || link.isError) return null;
  return (
    <div data-testid="open-in-telegram" className="rounded-2xl border border-[#229ED9]/30 bg-[#eaf6fc] p-4">
      <p className="flex items-center gap-2 text-sm font-extrabold text-[#136a93]"><Send size={16} /> {title}</p>
      <p className="mt-1 text-xs leading-relaxed text-[#2c5e75]">{hint}</p>
      {link.data ? (
        <a href={link.data.url} target="_blank" rel="noreferrer" data-testid="link-open-telegram" className="tap mt-3 flex h-11 items-center justify-center gap-2 rounded-full bg-[#229ED9] text-sm font-extrabold text-white">
          <Send size={15} /> Telegram'da ochish
        </a>
      ) : (
        <div className="mt-3 skeleton h-11 rounded-full" />
      )}
    </div>
  );
}
