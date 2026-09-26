import { FormEvent, useState } from 'react';
import { useAdminLogin, useAdminSetup, type AdminSession } from '@workspace/api-client-react';
import { KeyRound, LayoutDashboard, LoaderCircle } from 'lucide-react';

// The server answers with { error } in Uzbek; show it when there is one.
export function apiErrorMessage(error: unknown, fallback: string) {
  const data = (error as { data?: { error?: unknown } } | null)?.data;
  return typeof data?.error === 'string' ? data.error : fallback;
}

export const fieldClass =
  'mt-2 h-12 w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 text-sm outline-none transition focus:border-[hsl(var(--primary))] focus:ring-4 focus:ring-[hsl(var(--primary)/.1)]';

// Typed on phones too: no capitalisation or correction may touch what is typed.
const noAutoFix = { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false } as const;

export function AdminLogin({ onSuccess }: { onSuccess: (session: AdminSession) => void }) {
  const login = useAdminLogin();
  const setup = useAdminSetup();
  // 'setup' is for a super admin seeded without a password: they choose one
  // once, proving the deployment's access code.
  const [mode, setMode] = useState<'login' | 'setup'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const pending = login.isPending || setup.isPending;

  const submitLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!username.trim() || !password || pending) return;
    setError('');
    login.mutate({ data: { username: username.trim(), password } }, {
      onSuccess: session => { setPassword(''); onSuccess(session); },
      onError: err => {
        if ((err as { status?: number }).status === 409) {
          setMode('setup');
          setError('');
          return;
        }
        setError(apiErrorMessage(err, 'Kirishda xatolik. Qayta urinib ko‘ring.'));
      },
    });
  };

  const submitSetup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    if (newPassword.length < 8) return setError('Parol kamida 8 belgidan iborat bo‘lsin.');
    if (newPassword !== repeat) return setError('Parollar bir xil emas.');
    setError('');
    setup.mutate({ data: { username: username.trim(), access_code: accessCode, new_password: newPassword } }, {
      onSuccess: session => { setAccessCode(''); setNewPassword(''); setRepeat(''); onSuccess(session); },
      onError: err => setError(apiErrorMessage(err, 'Parolni o‘rnatib bo‘lmadi.')),
    });
  };

  return (
    <div className="container-wide flex min-h-[65vh] items-center justify-center py-10">
      <form onSubmit={mode === 'login' ? submitLogin : submitSetup} className="w-full max-w-md rounded-[28px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-[var(--shadow-sm)] sm:p-8">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#e8efdc] text-[hsl(var(--primary))]">
          {mode === 'login' ? <LayoutDashboard size={24} /> : <KeyRound size={24} />}
        </div>
        <div className="mt-5 text-center">
          <p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Operator kirishi</p>
          <h1 className="display mt-2 text-3xl font-extrabold">{mode === 'login' ? 'Admin panel' : 'Birinchi parol'}</h1>
          <p className="mt-2 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
            {mode === 'login'
              ? 'Login va parolingizni kiriting.'
              : 'Bu hisobga hali parol o‘rnatilmagan. Do‘konning kirish kodini kiriting va o‘zingizga parol tanlang.'}
          </p>
        </div>

        <label className="mt-7 block text-sm font-bold" htmlFor="admin-username">Login
          <input id="admin-username" data-testid="input-admin-username" value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" {...noAutoFix} disabled={mode === 'setup'} placeholder="masalan: shoxrux" className={fieldClass} />
        </label>

        {mode === 'login' ? (
          <label className="mt-4 block text-sm font-bold" htmlFor="admin-password">Parol
            <input id="admin-password" data-testid="input-admin-password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" {...noAutoFix} className={fieldClass} />
          </label>
        ) : (
          <>
            <label className="mt-4 block text-sm font-bold" htmlFor="admin-access-code">Do‘kon kirish kodi
              <input id="admin-access-code" data-testid="input-admin-access-code" type="password" value={accessCode} onChange={event => setAccessCode(event.target.value)} autoComplete="off" {...noAutoFix} className={fieldClass} />
            </label>
            <label className="mt-4 block text-sm font-bold" htmlFor="admin-new-password">Yangi parol
              <input id="admin-new-password" data-testid="input-admin-new-password" type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} autoComplete="new-password" {...noAutoFix} placeholder="kamida 8 belgi" className={fieldClass} />
            </label>
            <label className="mt-4 block text-sm font-bold" htmlFor="admin-repeat-password">Yangi parolni takrorlang
              <input id="admin-repeat-password" data-testid="input-admin-repeat-password" type="password" value={repeat} onChange={event => setRepeat(event.target.value)} autoComplete="new-password" {...noAutoFix} className={fieldClass} />
            </label>
          </>
        )}

        {error && (
          <p role="alert" className="mt-3 rounded-xl bg-[#fdf0ed] p-3 text-center text-sm font-semibold text-[#9d493e]">{error}</p>
        )}
        <button
          data-testid="button-admin-login"
          type="submit"
          disabled={pending || !username.trim() || (mode === 'login' ? !password : !accessCode || !newPassword || !repeat)}
          className="tap mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[hsl(var(--primary))] text-sm font-extrabold text-white disabled:opacity-50 transition hover:shadow-md"
        >
          {pending ? <LoaderCircle size={17} className="animate-spin" /> : <LayoutDashboard size={17} />}
          {mode === 'login' ? 'Kirish' : 'Parolni o‘rnatish va kirish'}
        </button>
        {mode === 'setup' && (
          <button type="button" onClick={() => { setMode('login'); setError(''); }} className="mt-3 w-full text-center text-xs font-bold text-[hsl(var(--muted-foreground))] underline underline-offset-2">
            Orqaga
          </button>
        )}
      </form>
    </div>
  );
}
