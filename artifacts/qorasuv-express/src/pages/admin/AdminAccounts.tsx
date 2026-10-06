import { FormEvent, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAdminSessionQueryKey,
  getListAdminsQueryKey,
  useCreateAdmin,
  useDeleteAdmin,
  useGetAdminSession,
  useListAdmins,
  useResetAdminPassword,
  type AdminAccount,
} from '@workspace/api-client-react';
import { Check, KeyRound, LoaderCircle, Send, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { apiErrorMessage } from './AdminLogin';
import { roleLabel } from './AdminProfile';
import { useConfirm } from '@/components/ConfirmDialog';

const input = 'h-11 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm outline-none focus:border-[hsl(var(--primary))]';
const noAutoFix = { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false } as const;

// A readable temporary password the super admin can pass on by voice or chat.
// The admin must replace it on first sign-in, so it only has to be unguessable
// for a short while.
function temporaryPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
}

function AdminRow({ admin, isSelf, onMessage }: { admin: AdminAccount; isSelf: boolean; onMessage: (text: string, isError?: boolean) => void }) {
  const qc = useQueryClient();
  const reset = useResetAdminPassword();
  const remove = useDeleteAdmin();
  const confirm = useConfirm();
  const [newTemp, setNewTemp] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: getListAdminsQueryKey() });

  const resetPassword = async () => {
    const temp = temporaryPassword();
    if (!(await confirm({
      message: `${admin.display_name} uchun yangi vaqtinchalik parol berilsinmi? U hamma qurilmalardan chiqariladi.`,
      confirmLabel: 'Parol berish',
    }))) return;
    reset.mutate({ id: admin.id, data: { temporary_password: temp } }, {
      onSuccess: () => { setNewTemp(temp); refresh(); },
      onError: err => onMessage(apiErrorMessage(err, 'Parolni tiklab bo‘lmadi.'), true),
    });
  };
  const deleteAdmin = async () => {
    if (!(await confirm({
      message: `${admin.display_name} (@${admin.username}) o‘chirilsinmi? U darhol tizimdan chiqariladi.`,
      confirmLabel: 'O‘chirish',
      danger: true,
    }))) return;
    remove.mutate({ id: admin.id }, {
      onSuccess: () => {
        onMessage(`${admin.display_name} o‘chirildi.`);
        refresh();
        if (isSelf) qc.invalidateQueries({ queryKey: getGetAdminSessionQueryKey() });
      },
      onError: err => onMessage(apiErrorMessage(err, 'O‘chirib bo‘lmadi.'), true),
    });
  };

  const status = !admin.has_password
    ? { text: 'Parol o‘rnatilmagan', tone: 'bg-[#fff0d4] text-[#a25e08]' }
    : admin.must_change_password
      ? { text: 'Vaqtinchalik parol', tone: 'bg-[#fff0d4] text-[#a25e08]' }
      : { text: 'Faol', tone: 'bg-[#e8efdc] text-[hsl(var(--primary))]' };

  return (
    <div data-testid={`row-admin-${admin.id}`} className="rounded-2xl border border-[hsl(var(--border))] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-extrabold">{admin.display_name} {isSelf && <span className="font-normal text-[hsl(var(--muted-foreground))]">(siz)</span>}</p>
          <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">@{admin.username}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold ${admin.role === 'super_admin' ? 'bg-[#25483e] text-white' : 'bg-[hsl(var(--muted))]'}`}><ShieldCheck size={11} /> {roleLabel(admin.role)}</span>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${status.tone}`}>{status.text}</span>
            {admin.telegram_linked && <span className="inline-flex items-center gap-1 rounded-full bg-[#e1f0ed] px-2.5 py-1 text-[10px] font-bold text-[#17695e]"><Send size={10} /> Telegram</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={resetPassword} disabled={reset.isPending} data-testid={`button-reset-admin-${admin.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-bold disabled:opacity-50"><KeyRound size={13} /> Parolni tiklash</button>
          <button type="button" onClick={deleteAdmin} disabled={remove.isPending} data-testid={`button-delete-admin-${admin.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-[#e6b2a8] px-3 py-1.5 text-xs font-bold text-[#9d493e] disabled:opacity-50"><Trash2 size={13} /> O‘chirish</button>
        </div>
      </div>
      {newTemp && (
        <p className="mt-3 rounded-xl bg-[#fff6dc] p-3 text-xs font-semibold text-[#7a4f07]">
          Yangi vaqtinchalik parol: <b className="mono select-all text-sm">{newTemp}</b><br />
          Uni {admin.display_name}ga bering. Kirgach, o‘z parolini tanlaydi. Bu parol boshqa ko‘rsatilmaydi.
        </p>
      )}
    </div>
  );
}

export function AdminAccounts() {
  const qc = useQueryClient();
  const session = useGetAdminSession({ query: { queryKey: getGetAdminSessionQueryKey() } });
  const me = session.data?.admin;
  const isSuper = me?.role === 'super_admin';
  const admins = useListAdmins({ query: { queryKey: getListAdminsQueryKey(), enabled: isSuper } });
  const create = useCreateAdmin();
  const [form, setForm] = useState({ username: '', display_name: '', role: 'admin' as 'admin' | 'super_admin' });
  const [created, setCreated] = useState<{ name: string; username: string; password: string } | null>(null);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  if (!me) return <div className="container-wide py-10"><div className="skeleton h-64 rounded-[26px]" /></div>;
  if (!isSuper) {
    return <div className="container-wide py-10"><p className="rounded-2xl bg-[hsl(var(--muted))] p-5 text-sm font-semibold">Bu bo‘lim faqat super adminlar uchun.</p></div>;
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const password = temporaryPassword();
    setMessage(null);
    create.mutate({ data: { ...form, username: form.username.trim().toLowerCase(), display_name: form.display_name.trim(), temporary_password: password } }, {
      onSuccess: admin => {
        setCreated({ name: admin.display_name, username: admin.username, password });
        setForm({ username: '', display_name: '', role: 'admin' });
        qc.invalidateQueries({ queryKey: getListAdminsQueryKey() });
      },
      onError: err => setMessage({ text: apiErrorMessage(err, 'Admin qo‘shilmadi.'), isError: true }),
    });
  };

  return (
    <div className="container-wide py-7 sm:py-10">
      <div className="mb-8">
        <p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Operator workspace / Adminlar</p>
        <h1 className="display mt-2 text-4xl font-extrabold sm:text-5xl">Adminlar</h1>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Har bir admin o‘z login va paroli bilan kiradi. Oxirgi super adminni o‘chirib bo‘lmaydi.</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <form onSubmit={submit} className="h-fit rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5">
          <div className="flex items-center gap-2"><UserPlus size={18} className="text-[hsl(var(--primary))]" /><h2 className="text-sm font-extrabold">Admin qo‘shish</h2></div>
          <label className="mt-4 block text-xs font-bold">Ismi
            <input required minLength={2} maxLength={60} value={form.display_name} onChange={event => setForm({ ...form, display_name: event.target.value })} placeholder="Ali" className={`mt-1.5 ${input}`} />
          </label>
          <label className="mt-3 block text-xs font-bold">Login
            <input required pattern="[a-z0-9_.\-]{3,32}" title="3–32 ta kichik lotin harfi, raqam, _ . -" value={form.username} onChange={event => setForm({ ...form, username: event.target.value.toLowerCase() })} placeholder="ali" {...noAutoFix} className={`mt-1.5 ${input}`} />
          </label>
          <label className="mt-3 block text-xs font-bold">Huquqi
            <select value={form.role} onChange={event => setForm({ ...form, role: event.target.value as typeof form.role })} className={`mt-1.5 ${input}`}>
              <option value="admin">Admin — buyurtma, mahsulot, chat</option>
              <option value="super_admin">Super admin — adminlarni ham boshqaradi</option>
            </select>
          </label>
          <button type="submit" disabled={create.isPending} data-testid="button-create-admin" className="tap mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] text-xs font-extrabold text-white disabled:opacity-50">
            {create.isPending && <LoaderCircle size={14} className="animate-spin" />} Qo‘shish
          </button>
          <p className="mt-3 text-[11px] text-[hsl(var(--muted-foreground))]">Vaqtinchalik parol avtomatik yaratiladi. Admin birinchi kirishda uni o‘zi almashtiradi.</p>
          {created && (
            <p role="status" className="mt-3 rounded-xl bg-[#fff6dc] p-3 text-xs font-semibold text-[#7a4f07]">
              <Check size={13} className="mr-1 inline" />{created.name} qo‘shildi.<br />
              Login: <b className="mono select-all">{created.username}</b><br />
              Vaqtinchalik parol: <b className="mono select-all text-sm">{created.password}</b><br />
              Buni unga bering. Bu parol boshqa ko‘rsatilmaydi.
            </p>
          )}
        </form>
        <section className="space-y-2">
          {message && <p role="status" className={`rounded-xl p-3 text-sm font-semibold ${message.isError ? 'bg-[#fdf0ed] text-[#9d493e]' : 'bg-[#e8efdc] text-[hsl(var(--primary))]'}`}>{message.text}</p>}
          {admins.isLoading ? <div className="skeleton h-40 rounded-2xl" /> : admins.data?.map(admin => (
            <AdminRow key={admin.id} admin={admin} isSelf={admin.id === me.id} onMessage={(text, isError = false) => setMessage({ text, isError })} />
          ))}
        </section>
      </div>
    </div>
  );
}
