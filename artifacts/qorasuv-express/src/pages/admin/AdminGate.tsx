import { ReactNode, useEffect } from 'react';
import { getGetAdminSessionQueryKey, useGetAdminSession } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { AdminLogin } from './AdminLogin';
import { PasswordChangeForm } from './AdminProfile';

// Every admin now has their own password and an eight-hour session, so the
// dashboard trusts a live session instead of signing out on every visit as it
// did with the one shared code. "Chiqish" still ends it, and the server ends
// it everywhere when the password changes or the admin is removed.
export function AdminGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const session = useGetAdminSession({ query: { queryKey: getGetAdminSessionQueryKey(), retry: false } });

  // A page restored from the back/forward cache may hold a session that has
  // since ended, so ask again.
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) qc.invalidateQueries({ queryKey: getGetAdminSessionQueryKey() });
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, [qc]);

  if (session.isLoading) {
    return <div className="flex min-h-[50vh] items-center justify-center"><LoaderCircle className="animate-spin text-[hsl(var(--primary))]" size={32} /></div>;
  }

  if (session.isError) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
        <p className="font-bold text-[hsl(var(--destructive))]">Server bilan aloqa yo‘q</p>
        <button onClick={() => session.refetch()} className="rounded-xl bg-[hsl(var(--primary))] px-4 py-2 font-bold text-white transition hover:opacity-90">Qayta urinish</button>
      </div>
    );
  }

  if (!session.data?.authenticated) {
    // The server has just answered with the session; putting it in the cache
    // unlocks the panel at once, with no refetch to wait for or race against.
    return <AdminLogin onSuccess={signedIn => qc.setQueryData(getGetAdminSessionQueryKey(), signedIn)} />;
  }

  // Signed in with a temporary password: the server refuses everything else
  // until it is replaced, so ask for that before showing the panel.
  if (session.data.admin?.must_change_password) {
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
