import { type FormEvent, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSendOrderFeedback } from '@workspace/api-client-react';
import { LoaderCircle, MessageSquareText, Send } from 'lucide-react';
import { apiErrorMessage } from '@/pages/admin/AdminLogin';
import { isMiniApp } from '@/lib/telegram-mini-app';
import { isSessionLost, renewTelegramSession } from '@/components/TelegramSignIn';
import { useT } from '@/i18n';
import messages from '@/i18n/messages/orderFeedback';

const MAX_LENGTH = 1000;

// A comment on a delivered order. It is not stored: the server hands it to
// the admins through the Telegram bot, with the order and who wrote it, and
// forgets it. So the box clears only once it has really gone.
export function OrderFeedback({ orderId }: { orderId: number }) {
  const { t } = useT(messages);
  const qc = useQueryClient();
  const send = useSendOrderFeedback();
  const [renewing, setRenewing] = useState(false);
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  if (!isMiniApp()) return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = text.trim();
    if (!body || send.isPending || renewing) return;
    setError('');
    const attempt = (afterRenewal: boolean) => send.mutate({ id: orderId, data: { text: body } }, {
      onSuccess: () => { setText(''); setSent(true); },
      onError: async err => {
        // The session can be gone (an admin signed this device out): sign in
        // again by Telegram's launch data and send it once more.
        if (isSessionLost(err) && !afterRenewal) {
          setRenewing(true);
          const renewed = await renewTelegramSession(qc);
          setRenewing(false);
          if (renewed === 'ok') return attempt(true);
          return setError(renewed === 'blocked'
            ? t('blocked')
            : renewed === 'stale' ? t('stale') : t('offline'));
        }
        setError(apiErrorMessage(err, t('sendFailed')));
      },
    });
    attempt(false);
  };

  return (
    <form onSubmit={submit} data-testid="form-order-feedback" className="rounded-[24px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5">
      <h2 className="flex items-center gap-2 display text-lg font-extrabold"><MessageSquareText size={18} className="text-[hsl(var(--primary))]" /> {t('title')}</h2>
      <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{t('hint')}</p>
      {sent && <p role="status" data-testid="text-feedback-sent" className="mt-3 rounded-xl bg-[#e8efdc] p-3 text-xs font-semibold text-[hsl(var(--primary))]">{t('sent')}</p>}
      <textarea
        data-testid="input-order-feedback"
        value={text}
        onChange={event => { setText(event.target.value.slice(0, MAX_LENGTH)); setSent(false); }}
        rows={3}
        maxLength={MAX_LENGTH}
        placeholder={t('placeholder')}
        className="mt-3 w-full resize-none rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3 text-sm outline-none focus:border-[hsl(var(--primary))]"
      />
      {error && <p role="alert" className="mt-2 rounded-xl bg-[#fdf0ed] p-2.5 text-xs font-semibold text-[#9d493e]">{error}</p>}
      <button type="submit" data-testid="button-send-feedback" disabled={!text.trim() || send.isPending || renewing} className="tap mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] text-sm font-extrabold text-white disabled:opacity-50">
        {send.isPending || renewing ? <LoaderCircle size={15} className="animate-spin" /> : <Send size={15} />} {t('send')}
      </button>
    </form>
  );
}
