import { ReactNode, useEffect, useRef, useState } from 'react';
import { useAdminLogout, getGetAdminDashboardQueryKey, getListAdminOrdersQueryKey, getGetAdminSessionQueryKey, useGetAdminSession } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { AdminLogin } from './AdminLogin';
import { PasswordChangeForm } from './AdminProfile';

export function AdminGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const logout = useAdminLogout();
  const qc = useQueryClient();
  const inflight = useRef(false);
  const mounted = useRef(true);

  const session = useGetAdminSession({ query: { queryKey: getGetAdminSessionQueryKey(), retry: false } });

  const resetSession = () => {
    if (inflight.current) return;
    inflight.current = true;
    setStatus('loading');
    setUnlocked(false);

    logout.mutate(undefined, {
      onSuccess: () => {
        qc.removeQueries({ queryKey: getGetAdminDashboardQueryKey() });
        qc.removeQueries({ queryKey: getListAdminOrdersQueryKey() });
        qc.removeQueries({ queryKey: getGetAdminSessionQueryKey() });
        if (mounted.current) setStatus('ready');
      },
      onError: (err: any) => {
        if (err?.response?.status === 401 || err?.status === 401) {
          qc.removeQueries({ queryKey: getGetAdminDashboardQueryKey() });
          qc.removeQueries({ queryKey: getListAdminOrdersQueryKey() });
          qc.removeQueries({ queryKey: getGetAdminSessionQueryKey() });
          if (mounted.current) setStatus('ready');
        } else {
          if (mounted.current) setStatus('error');
        }
      },
      onSettled: () => {
        inflight.current = false;
      }
    });
  };

  useEffect(() => {
    mounted.current = true;
    resetSession();

    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        resetSession();
      }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      mounted.current = false;
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, []);

  useEffect(() => {
    if (unlocked && (session.isError || (session.data && !session.data.authenticated))) {
      setUnlocked(false);
    }
  }, [unlocked, session.isError, session.data]);

  if (status === 'loading') return <div className="flex min-h-[50vh] items-center justify-center"><LoaderCircle className="animate-spin text-[hsl(var(--primary))]" size={32} /></div>;

  if (status === 'error') return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
      <p className="font-bold text-[hsl(var(--destructive))]">Sessiyani tozalashda xatolik</p>
      <button onClick={() => resetSession()} className="rounded-xl bg-[hsl(var(--primary))] px-4 py-2 font-bold text-white transition hover:opacity-90">Qayta urinish</button>
    </div>
  );

  if (!unlocked) {
    return <AdminLogin onSuccess={signedIn => {
      // The cached session still says "not authenticated" from when the page
      // opened, and the effect above would read that before any refetch lands
      // and lock the panel again, so the first correct login seemed to fail.
      // The server has just answered with the session, so record it before
      // unlocking.
      qc.setQueryData(getGetAdminSessionQueryKey(), signedIn);
      setUnlocked(true);
    }} />;
  }

  // Signed in with a temporary password: the server refuses everything else
  // until it is replaced, so ask for that before showing the panel.
  if (session.data?.admin?.must_change_password) {
    return (
      <div className="container-wide flex min-h-[65vh] items-center justify-center py-10">
        <div className="w-full max-w-md">
          <p className="mb-4 rounded-2xl bg-[#fff6dc] p-4 text-sm font-semibold text-[#7a4f07]">
            Salom, {session.data.admin.display_name}! Siz vaqtinchalik parol bilan kirdingiz. Davom etish uchun o‘zingizga yangi parol tanlang.
          </p>
          <PasswordChangeForm title="Yangi parol tanlang" />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
