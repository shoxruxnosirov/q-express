import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListAdminCustomersQueryKey,
  getListCustomerSessionsQueryKey,
  useBlockCustomerSession,
  useListCustomerSessions,
  useRevokeCustomerSession,
  useUnblockCustomerSession,
  type CustomerSession,
} from '@workspace/api-client-react';
import { Ban, Globe, LogOut, Send } from 'lucide-react';
import { apiErrorMessage } from './AdminLogin';
import { useAsk, useConfirm } from '@/components/ConfirmDialog';

const date = (value: string) =>
  new Intl.DateTimeFormat('uz-UZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

// Enough of a user agent to tell two phones apart, without the noise.
function deviceLabel(session: CustomerSession) {
  const agent = session.user_agent ?? '';
  const system = /Android/i.test(agent) ? 'Android'
    : /iPhone|iPad|iOS/i.test(agent) ? 'iPhone'
      : /Windows/i.test(agent) ? 'Windows'
        : /Mac OS/i.test(agent) ? 'Mac'
          : /Linux/i.test(agent) ? 'Linux' : '';
  const browser = session.source === 'telegram' ? 'Telegram Mini App'
    : /Edg\//.test(agent) ? 'Edge'
      : /OPR\//.test(agent) ? 'Opera'
        : /Chrome\//.test(agent) ? 'Chrome'
          : /Firefox\//.test(agent) ? 'Firefox'
            : /Safari\//.test(agent) ? 'Safari' : 'Brauzer';
  return system ? `${browser} · ${system}` : browser;
}

// One customer's devices: where they are signed in, and the means to sign a
// device out (any admin) or block it (super admins).
export function CustomerDevices({ customerId, canBlock }: { customerId: number; canBlock: boolean }) {
  const qc = useQueryClient();
  const sessions = useListCustomerSessions(customerId, { query: { queryKey: getListCustomerSessionsQueryKey(customerId) } });
  const revoke = useRevokeCustomerSession();
  const block = useBlockCustomerSession();
  const unblock = useUnblockCustomerSession();
  const confirm = useConfirm();
  const ask = useAsk();
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const busy = revoke.isPending || block.isPending || unblock.isPending;

  const put = (updated: CustomerSession, text: string) => {
    qc.setQueryData<CustomerSession[]>(getListCustomerSessionsQueryKey(customerId), list => list?.map(item => (item.id === updated.id ? updated : item)));
    // The device count on the customer's card changes too.
    qc.invalidateQueries({ queryKey: getListAdminCustomersQueryKey() });
    setMessage({ text });
  };
  const failed = (err: unknown, fallback: string) => setMessage({ text: apiErrorMessage(err, fallback), error: true });

  const signOut = async (session: CustomerSession) => {
    const hint = session.source === 'telegram'
      ? ' Mini App’ni qayta ochsa, Telegram uni yana kiritadi; butunlay to‘xtatish uchun bloklang.'
      : '';
    if (!(await confirm({ message: `${deviceLabel(session)} qurilmasidan chiqarilsinmi?${hint}`, confirmLabel: 'Chiqarish' }))) return;
    revoke.mutate({ id: session.id }, {
      onSuccess: updated => put(updated, 'Qurilmadan chiqarildi.'),
      onError: err => failed(err, 'Chiqarib bo‘lmadi.'),
    });
  };
  const blockSession = async (session: CustomerSession) => {
    const scope = session.source === 'telegram'
      ? 'Bu Telegram akkaunt do‘konga boshqa kira olmaydi.'
      : 'Bu brauzer buyurtma bera olmaydi va yoza olmaydi (cookie tozalansa, blok ham ketadi: butunlay to‘xtatish uchun mijozni bloklang).';
    const reason = await ask({
      message: `${deviceLabel(session)} bloklansinmi? ${scope}`,
      inputLabel: 'Sabab (ixtiyoriy)',
      maxLength: 200,
      confirmLabel: 'Bloklash',
      danger: true,
    });
    if (reason === null) return;
    if (reason.trim().length > 200) return setMessage({ text: 'Sabab 200 belgidan oshmasin.', error: true });
    block.mutate({ id: session.id, data: { reason: reason.trim() } }, {
      onSuccess: updated => put(updated, 'Qurilma bloklandi.'),
      onError: err => failed(err, 'Bloklab bo‘lmadi.'),
    });
  };
  const unblockSession = async (session: CustomerSession) => {
    if (!(await confirm({ message: `${deviceLabel(session)} blokdan chiqarilsinmi?`, confirmLabel: 'Blokdan chiqarish' }))) return;
    unblock.mutate({ id: session.id }, {
      onSuccess: updated => put(updated, 'Qurilma blokdan chiqarildi.'),
      onError: err => failed(err, 'Blokdan chiqarib bo‘lmadi.'),
    });
  };

  if (sessions.isLoading) return <div className="mt-3 skeleton h-14 rounded-xl" />;
  if (sessions.isError) return <p className="mt-3 text-xs text-[#9d493e]">Qurilmalarni yuklab bo‘lmadi.</p>;
  const list = sessions.data ?? [];
  return (
    <div data-testid={`devices-${customerId}`} className="mt-3 space-y-2 rounded-xl bg-[hsl(var(--muted)/.5)] p-3">
      {message && <p role="status" className={`rounded-lg p-2 text-xs font-semibold ${message.error ? 'bg-[#fdf0ed] text-[#9d493e]' : 'bg-[#e8efdc] text-[hsl(var(--primary))]'}`}>{message.text}</p>}
      {list.length === 0 && <p className="text-xs text-[hsl(var(--muted-foreground))]">Qurilma yo‘q.</p>}
      {list.map(session => (
        <div key={session.id} data-testid={`row-session-${session.id}`} className={`rounded-lg border p-2.5 text-xs ${session.blocked ? 'border-[#e6b2a8] bg-[#fdf6f4]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))]'}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-bold">
                {session.source === 'telegram' ? <Send size={12} className="text-[#229ED9]" /> : <Globe size={12} className="text-[hsl(var(--muted-foreground))]" />}
                {deviceLabel(session)}
              </p>
              <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                Oxirgi marta: {date(session.last_seen_at)} · Kirgan: {date(session.created_at)}
              </p>
              {session.blocked ? (
                <p className="mt-0.5 text-[11px] font-semibold text-[#8c1d18]">
                  Bloklangan{session.blocked_by ? `: ${session.blocked_by}` : ''}{session.blocked_at ? `, ${date(session.blocked_at)}` : ''}{session.block_reason ? `. Sabab: ${session.block_reason}` : ''}
                </p>
              ) : session.revoked_at ? (
                <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">Chiqarilgan: {date(session.revoked_at)}</p>
              ) : (
                <p className="mt-0.5 text-[11px] font-semibold text-[hsl(var(--primary))]">Faol</p>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {session.current && (
                <button type="button" data-testid={`button-revoke-session-${session.id}`} onClick={() => signOut(session)} disabled={busy} className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--border))] px-2.5 py-1 text-[11px] font-bold text-[hsl(var(--muted-foreground))] disabled:opacity-50"><LogOut size={11} /> Chiqarish</button>
              )}
              {canBlock && (session.blocked ? (
                <button type="button" data-testid={`button-unblock-session-${session.id}`} onClick={() => unblockSession(session)} disabled={busy} className="rounded-full border border-[hsl(var(--primary)/.4)] px-2.5 py-1 text-[11px] font-bold text-[hsl(var(--primary))] disabled:opacity-50">Blokdan chiqarish</button>
              ) : (
                <button type="button" data-testid={`button-block-session-${session.id}`} onClick={() => blockSession(session)} disabled={busy} className="inline-flex items-center gap-1 rounded-full border border-[#e6b2a8] px-2.5 py-1 text-[11px] font-bold text-[#9d493e] disabled:opacity-50"><Ban size={11} /> Bloklash</button>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
