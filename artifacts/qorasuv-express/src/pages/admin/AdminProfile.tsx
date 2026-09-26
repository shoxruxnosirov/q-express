import { FormEvent, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAdminSessionQueryKey,
  useChangeOwnAdminPassword,
  useCreateTelegramLink,
  useGetAdminSession,
  useUnlinkTelegram,
  type AdminSession,
  type TelegramLink,
} from '@workspace/api-client-react';
import { Check, KeyRound, LoaderCircle, Send, ShieldCheck, UserRound } from 'lucide-react';
import { apiErrorMessage, fieldClass } from './AdminLogin';

const noAutoFix = { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false } as const;
export const roleLabel = (role: string) => (role === 'super_admin' ? 'Super admin' : 'Admin');

// Used on the profile page and, forced, right after signing in with a
// temporary password.
export function PasswordChangeForm({ onChanged, title = 'Parolni almashtirish' }: { onChanged?: (session: AdminSession) => void; title?: string }) {
  const change = useChangeOwnAdminPassword();
  const qc = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (change.isPending) return;
    setDone(false);
    if (next.length < 8) return setError('Yangi parol kamida 8 belgidan iborat bo‘lsin.');
    if (next !== repeat) return setError('Yangi parollar bir xil emas.');
    setError('');
    change.mutate({ data: { current_password: current, new_password: next } }, {
      onSuccess: session => {
        setCurrent(''); setNext(''); setRepeat(''); setDone(true);
        qc.setQueryData(getGetAdminSessionQueryKey(), session);
        onChanged?.(session);
      },
      onError: err => setError(apiErrorMessage(err, 'Parolni almashtirib bo‘lmadi.')),
    });
  };

  return (
    <form onSubmit={submit} data-testid="form-password-change" className="rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-6">
      <div className="flex items-center gap-2"><KeyRound size={18} className="text-[hsl(var(--primary))]" /><h2 className="text-sm font-extrabold">{title}</h2></div>
      <label className="mt-4 block text-sm font-bold">Joriy parol
        <input data-testid="input-current-password" type="password" value={current} onChange={event => setCurrent(event.target.value)} autoComplete="current-password" {...noAutoFix} className={fieldClass} />
      </label>
      <label className="mt-4 block text-sm font-bold">Yangi parol
        <input data-testid="input-new-password" type="password" value={next} onChange={event => setNext(event.target.value)} autoComplete="new-password" {...noAutoFix} placeholder="kamida 8 belgi" className={fieldClass} />
      </label>
      <label className="mt-4 block text-sm font-bold">Yangi parolni takrorlang
        <input data-testid="input-repeat-password" type="password" value={repeat} onChange={event => setRepeat(event.target.value)} autoComplete="new-password" {...noAutoFix} className={fieldClass} />
      </label>
      {error && <p role="alert" className="mt-3 rounded-xl bg-[#fdf0ed] p-3 text-sm font-semibold text-[#9d493e]">{error}</p>}
      {done && <p role="status" className="mt-3 rounded-xl bg-[#e8efdc] p-3 text-sm font-semibold text-[hsl(var(--primary))]"><Check size={14} className="mr-1 inline" />Parol almashtirildi. Boshqa qurilmalardagi sessiyalar yopildi.</p>}
      <button type="submit" data-testid="button-change-password" disabled={change.isPending || !current || !next || !repeat} className="tap mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[hsl(var(--primary))] text-sm font-extrabold text-white disabled:opacity-50">
        {change.isPending && <LoaderCircle size={16} className="animate-spin" />} Saqlash
      </button>
    </form>
  );
}

function TelegramCard({ linked }: { linked: boolean }) {
  const qc = useQueryClient();
  const createLink = useCreateTelegramLink();
  const unlink = useUnlinkTelegram();
  const [link, setLink] = useState<TelegramLink | null>(null);
  const [error, setError] = useState('');

  const start = () => {
    setError('');
    createLink.mutate(undefined, {
      onSuccess: setLink,
      onError: err => setError(apiErrorMessage(err, 'Havola yaratilmadi.')),
    });
  };
  const disconnect = () => {
    setError('');
    unlink.mutate(undefined, {
      onSuccess: session => { setLink(null); qc.setQueryData(getGetAdminSessionQueryKey(), session); },
      onError: err => setError(apiErrorMessage(err, 'Uzib bo‘lmadi.')),
    });
  };
  // After the admin presses Start in Telegram, the session says so.
  const refresh = () => qc.invalidateQueries({ queryKey: getGetAdminSessionQueryKey() });

  return (
    <section className="rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-6">
      <div className="flex items-center gap-2"><Send size={18} className="text-[hsl(var(--primary))]" /><h2 className="text-sm font-extrabold">Telegram xabarnomalari</h2></div>
      <p className="mt-2 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
        Ulangan bo‘lsa, yangi buyurtma va mijoz xabarlari botda sizga ham keladi. Bot xabariga Reply qilib mijozga javob bera olasiz.
      </p>
      {linked ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e8efdc] px-3 py-1.5 text-xs font-bold text-[hsl(var(--primary))]"><Check size={13} /> Ulangan</span>
          <button type="button" onClick={disconnect} disabled={unlink.isPending} className="rounded-full border border-[hsl(var(--border))] px-4 py-2 text-xs font-bold text-[hsl(var(--muted-foreground))] disabled:opacity-50">Uzish</button>
        </div>
      ) : link ? (
        <div className="mt-4 space-y-3">
          <a href={link.url} target="_blank" rel="noreferrer" data-testid="link-telegram-connect" className="tap flex h-12 items-center justify-center gap-2 rounded-full bg-[#229ED9] text-sm font-extrabold text-white">
            <Send size={16} /> Telegram'da ochib, Start bosing
          </a>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Havola bir marta ishlaydi va 30 daqiqada eskiradi. Uni boshqa odamga bermang.</p>
          <button type="button" onClick={refresh} className="text-xs font-bold text-[hsl(var(--primary))] underline underline-offset-2">Start bosdim, tekshirish</button>
        </div>
      ) : (
        <button type="button" onClick={start} disabled={createLink.isPending} data-testid="button-telegram-link" className="tap mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[hsl(var(--primary))] text-sm font-extrabold text-white disabled:opacity-50">
          {createLink.isPending && <LoaderCircle size={16} className="animate-spin" />} Telegram'ni ulash
        </button>
      )}
      {error && <p role="alert" className="mt-3 rounded-xl bg-[#fdf0ed] p-3 text-sm font-semibold text-[#9d493e]">{error}</p>}
    </section>
  );
}

export function AdminProfile() {
  const session = useGetAdminSession({ query: { queryKey: getGetAdminSessionQueryKey() } });
  const admin = session.data?.admin;
  if (!admin) return <div className="container-wide py-10"><div className="skeleton h-64 rounded-[26px]" /></div>;

  return (
    <div className="container-wide py-7 sm:py-10">
      <div className="mb-8">
        <p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Operator workspace / Profil</p>
        <h1 className="display mt-2 text-4xl font-extrabold sm:text-5xl">Profilim</h1>
      </div>
      <div className="grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
        <section className="h-fit rounded-[26px] bg-[hsl(var(--primary))] p-6 text-white sm:p-8">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#f4cc73] text-[#25483e]"><UserRound size={28} /></div>
          <h2 data-testid="text-admin-name" className="display mt-6 text-3xl font-extrabold">{admin.display_name}</h2>
          <p className="mt-1 text-sm text-[#d9e5ce]">@{admin.username}</p>
          <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-bold"><ShieldCheck size={13} /> {roleLabel(admin.role)}</span>
        </section>
        <div className="space-y-4">
          <PasswordChangeForm />
          <TelegramCard linked={admin.telegram_linked} />
        </div>
      </div>
    </div>
  );
}
