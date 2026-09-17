import { FormEvent, useState } from 'react';
import { useAdminLogin, getGetAdminSessionQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { LayoutDashboard, LoaderCircle } from 'lucide-react';

export function AdminLogin({ onSuccess }: { onSuccess?: () => void }) {
  const login = useAdminLogin();
  const qc = useQueryClient();
  const [code, setCode] = useState('');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!code.trim() || login.isPending) return;
    
    login.mutate({ data: { code } }, {
      onSuccess: () => {
        setCode('');
        qc.invalidateQueries({ queryKey: getGetAdminSessionQueryKey() });
        if (onSuccess) onSuccess();
      },
    });
  };

  return (
    <div className="container-wide flex min-h-[65vh] items-center justify-center py-10">
      <form onSubmit={submit} className="w-full max-w-md rounded-[28px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-[var(--shadow-sm)] sm:p-8">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#e8efdc] text-[hsl(var(--primary))]">
          <LayoutDashboard size={24} />
        </div>
        <div className="mt-5 text-center">
          <p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Operator kirishi</p>
          <h1 className="display mt-2 text-3xl font-extrabold">Admin panel</h1>
          <p className="mt-2 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">Buyurtmalarni boshqarish uchun operator kodini kiriting.</p>
        </div>
        <label className="mt-7 block text-sm font-bold" htmlFor="admin-access-code">Kirish kodi
          <input 
            id="admin-access-code" 
            data-testid="input-admin-access-code" 
            type="password" 
            autoComplete="current-password" 
            inputMode="numeric" 
            value={code} 
            onChange={event => setCode(event.target.value)} 
            placeholder="Kodni kiriting" 
            className="mt-2 h-12 w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 text-center text-lg tracking-[.3em] outline-none transition focus:border-[hsl(var(--primary))] focus:ring-4 focus:ring-[hsl(var(--primary)/.1)]" 
          />
        </label>
        {login.isError && (
          <p role="alert" className="mt-3 rounded-xl bg-[#fdf0ed] p-3 text-center text-sm font-semibold text-[#9d493e]">Kod noto‘g‘ri. Qayta urinib ko‘ring.</p>
        )}
        <button 
          data-testid="button-admin-login" 
          type="submit" 
          disabled={!code.trim() || login.isPending} 
          className="tap mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[hsl(var(--primary))] text-sm font-extrabold text-white disabled:opacity-50 transition hover:shadow-md"
        >
          {login.isPending ? <LoaderCircle size={17} className="animate-spin" /> : <LayoutDashboard size={17} />} Kirish
        </button>
      </form>
    </div>
  );
}
