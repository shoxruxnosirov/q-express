import { ReactNode, useEffect, useRef, useState } from 'react';
import { useAdminLogout, getGetAdminDashboardQueryKey, getListAdminOrdersQueryKey, getGetAdminSessionQueryKey, useGetAdminSession } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { AdminLogin } from './AdminLogin';

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
    return <AdminLogin onSuccess={() => {
      setUnlocked(true);
      session.refetch();
    }} />;
  }
  
  return <>{children}</>;
}
