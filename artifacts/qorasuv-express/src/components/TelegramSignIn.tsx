import { useEffect, useRef } from 'react';
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { getGetCustomerProfileQueryKey, signInWithTelegram, type CustomerProfile } from '@workspace/api-client-react';
import { Ban } from 'lucide-react';
import { isMiniApp, setSessionToken, startMiniApp, telegramInitData } from '@/lib/telegram-mini-app';

// Set when the server refused this Telegram account as blocked. No session is
// opened then, so the profile cannot say it; this flag does, for the banner
// and the checkout.
const BLOCKED_KEY = ['qorasuv', 'telegram-blocked'] as const;

export function useTelegramBlocked() {
  const { data } = useQuery({ queryKey: BLOCKED_KEY, queryFn: () => false, enabled: false, initialData: false });
  return data;
}

// failed: the network or the server let us down; worth another try later.
export type RenewResult = 'ok' | 'blocked' | 'stale' | 'failed';

// One sign-in at a time: a lost session is usually noticed by several calls
// at once (the profile, the chat, a button), and they all wait for the same
// answer instead of each signing in.
let inFlight: Promise<RenewResult> | null = null;
// Once Telegram's data is too old, or the account is blocked, signing in
// again cannot help until the Mini App is reopened; nothing retries it.
let settled: RenewResult | null = null;
// Signing in again by itself happens at most this often, so nothing can turn
// it into a loop against the server.
const AUTO_RENEW_GAP_MS = 30_000;
let lastAutoRenew = 0;

// Signs this Mini App in by Telegram's launch data: on every launch, and
// again whenever the session turns out to be gone (an admin signed the device
// out). 'stale' means Telegram's data is too old to sign in with (over an
// hour); only reopening the Mini App brings fresh data.
export function renewTelegramSession(qc: QueryClient): Promise<RenewResult> {
  if (inFlight) return inFlight;
  inFlight = (async (): Promise<RenewResult> => {
    try {
      const session = await signInWithTelegram({ init_data: telegramInitData() });
      setSessionToken(session.session_token);
      settled = null;
      qc.setQueryData(BLOCKED_KEY, false);
      qc.setQueryData(getGetCustomerProfileQueryKey(), session.profile);
      // Everything fetched before the sign-in was fetched as nobody.
      qc.invalidateQueries({ predicate: query => query.queryKey[0] !== getGetCustomerProfileQueryKey()[0] && query.queryKey[0] !== BLOCKED_KEY[0] });
      return 'ok';
    } catch (error) {
      const { status, data } = (error ?? {}) as { status?: number; data?: { blocked?: unknown } | null };
      if (data?.blocked === true) {
        settled = 'blocked';
        qc.setQueryData(BLOCKED_KEY, true);
        return settled;
      }
      // Only the server saying the launch data is not good (too old) is final;
      // a dropped connection or a server error is tried again later.
      if (status === 401) {
        settled = 'stale';
        return settled;
      }
      return 'failed';
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

// An answer that means "this Mini App has no session": the order and the
// feedback routes say telegram_required, the chat says chat_closed.
export function isSessionLost(error: unknown) {
  const data = (error as { data?: { telegram_required?: unknown; chat_closed?: unknown } } | null)?.data;
  return data?.telegram_required === true || data?.chat_closed === true;
}

// Opened as a Mini App, the shop hands Telegram's signed initData to the
// server on every launch. That is the whole sign-in: the Telegram account is
// the customer, created on first sight, so nobody types anything. Doing it on
// every launch also keeps the webview with whichever Telegram account opened
// it, when two share one phone. The session token that comes back is sent as
// a bearer header from then on (see main.tsx), so Telegram Web works too.
//
// It also watches for the session going away while the Mini App is open (an
// admin signed this device out): a profile that says nobody is signed in, or
// any call answered as having no session, signs it in again, so the chat, the
// profile and the buttons come back without reopening the Mini App.
export function TelegramSignIn() {
  const qc = useQueryClient();
  const attempted = useRef(false);
  const blocked = useTelegramBlocked();

  useEffect(() => {
    if (!isMiniApp() || attempted.current) return;
    attempted.current = true;
    startMiniApp();
    void renewTelegramSession(qc);
  }, [qc]);

  useEffect(() => {
    if (!isMiniApp()) return;
    const profileKey = getGetCustomerProfileQueryKey()[0];
    const renew = () => {
      if (settled || inFlight || Date.now() - lastAutoRenew < AUTO_RENEW_GAP_MS) return;
      lastAutoRenew = Date.now();
      void renewTelegramSession(qc);
    };
    const stopQueries = qc.getQueryCache().subscribe(event => {
      if (event.type !== 'updated') return;
      const { queryKey, state } = event.query;
      if (queryKey[0] === profileKey && state.status === 'success' && (state.data as CustomerProfile | undefined)?.authenticated === false) renew();
      else if (state.status === 'error' && isSessionLost(state.error)) renew();
    });
    const stopMutations = qc.getMutationCache().subscribe(event => {
      if (event.type === 'updated' && event.mutation.state.status === 'error' && isSessionLost(event.mutation.state.error)) renew();
    });
    return () => { stopQueries(); stopMutations(); };
  }, [qc]);

  if (!blocked) return null;
  return (
    <div role="alert" data-testid="banner-telegram-blocked" className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-[#8c1d18] px-4 py-2.5 text-center text-xs font-bold text-white">
      <Ban size={14} /> Hisobingiz do‘kon tomonidan bloklangan. Buyurtma berish va yozish imkoni yo‘q.
    </div>
  );
}
