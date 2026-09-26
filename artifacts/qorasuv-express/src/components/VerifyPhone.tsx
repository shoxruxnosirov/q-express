import { FormEvent, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetChatTranscriptQueryKey,
  getGetCustomerLoginLinkQueryKey,
  getGetCustomerProfileQueryKey,
  getListOrdersQueryKey,
  useGetCustomerLoginLink,
  useVerifyCustomerLogin,
  type CustomerProfile,
} from '@workspace/api-client-react';
import { BadgeCheck, LoaderCircle, Send } from 'lucide-react';
import { apiErrorMessage } from '@/pages/admin/AdminLogin';

// Verifying the phone through @Q_express_bot. The bot hands out a code only
// after the customer shares their own number with Telegram's contact button,
// so a typed or borrowed number cannot be verified.
export function VerifyPhone({ phone: initialPhone, title, hint, onVerified }: {
  phone: string;
  title: string;
  hint: string;
  onVerified?: (profile: CustomerProfile) => void;
}) {
  const qc = useQueryClient();
  const link = useGetCustomerLoginLink({ query: { queryKey: getGetCustomerLoginLinkQueryKey(), staleTime: Infinity, retry: false } });
  const verify = useVerifyCustomerLogin();
  const [phone, setPhone] = useState(initialPhone);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (verify.isPending) return;
    setError('');
    verify.mutate({ data: { phone, code } }, {
      onSuccess: profile => {
        setCode('');
        qc.setQueryData(getGetCustomerProfileQueryKey(), profile);
        // Signing in may have brought orders, addresses and a chat from
        // another device, and changes the delivery fee.
        qc.invalidateQueries({ queryKey: getListOrdersQueryKey() });
        qc.invalidateQueries({ queryKey: getGetChatTranscriptQueryKey() });
        qc.invalidateQueries({ predicate: query => String(query.queryKey[0]).startsWith('/api/orders/delivery-fee') });
        onVerified?.(profile);
      },
      onError: err => setError(apiErrorMessage(err, 'Kod tasdiqlanmadi.')),
    });
  };

  return (
    <div data-testid="verify-phone" className="rounded-2xl border border-[#229ED9]/30 bg-[#eaf6fc] p-4">
      <p className="flex items-center gap-2 text-sm font-extrabold text-[#136a93]"><BadgeCheck size={17} /> {title}</p>
      <p className="mt-1 text-xs leading-relaxed text-[#2c5e75]">{hint}</p>
      <ol className="mt-3 space-y-1 text-xs font-semibold text-[#2c5e75]">
        <li>1. Pastdagi tugma orqali botni oching va <b>Start</b> ni bosing.</li>
        <li>2. Botda <b>📱 Raqamni yuborish</b> ni bosing, bot 6 xonali kod yuboradi.</li>
        <li>3. Kodni shu yerga kiriting.</li>
      </ol>
      {link.data ? (
        <a href={link.data.url} target="_blank" rel="noreferrer" data-testid="link-verify-telegram" className="tap mt-3 flex h-11 items-center justify-center gap-2 rounded-full bg-[#229ED9] text-sm font-extrabold text-white">
          <Send size={15} /> Telegram'da ochish
        </a>
      ) : link.isError ? (
        <p className="mt-3 rounded-xl bg-[#fdf0ed] p-2.5 text-xs font-semibold text-[#9d493e]">Telegram bot hozir ishlamayapti. Keyinroq urinib ko‘ring.</p>
      ) : (
        <div className="mt-3 skeleton h-11 rounded-full" />
      )}
      <form onSubmit={submit} className="mt-3 grid gap-2 sm:grid-cols-[1fr_130px_auto]">
        <input data-testid="input-verify-phone" value={phone} onChange={event => setPhone(event.target.value)} type="tel" autoComplete="tel" placeholder="+998 90 123 45 67" className="h-11 rounded-xl border border-[hsl(var(--border))] bg-white px-3 text-sm outline-none focus:border-[#229ED9]" />
        <input data-testid="input-verify-code" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="Kod" className="h-11 rounded-xl border border-[hsl(var(--border))] bg-white px-3 text-center text-sm font-bold tracking-[.3em] outline-none focus:border-[#229ED9]" />
        <button type="submit" data-testid="button-verify-code" disabled={code.length !== 6 || phone.trim().length < 7 || verify.isPending} className="tap flex h-11 items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 text-xs font-extrabold text-white disabled:opacity-50">
          {verify.isPending && <LoaderCircle size={14} className="animate-spin" />} Tasdiqlash
        </button>
      </form>
      {error && <p role="alert" className="mt-2 rounded-xl bg-[#fdf0ed] p-2.5 text-xs font-semibold text-[#9d493e]">{error}</p>}
    </div>
  );
}
