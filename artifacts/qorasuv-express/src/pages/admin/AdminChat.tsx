import { type FormEvent, useEffect, useRef, useState } from 'react';
import { LoaderCircle, MessageCircle, Send, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAdminChatTranscriptQueryKey,
  getListAdminChatsQueryKey,
  useGetAdminChatTranscript,
  useDeleteAdminChat,
  useListAdminChats,
  useSendAdminChatMessage,
} from '@workspace/api-client-react';
import { telegramLabel, telegramProfileUrl } from '@/lib/telegram-label';
import { useConfirm } from '@/components/ConfirmDialog';

// Same reasoning as the customer widget: the free instance sleeps, so the page
// polls instead of holding a socket open.
const THREADS_POLL_MS = 10000;
const MESSAGES_POLL_MS = 5000;

const time = (value: string) =>
  new Intl.DateTimeFormat('uz-UZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(
    new Date(value),
  );

export function AdminChat() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [failed, setFailed] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const threads = useListAdminChats({
    query: { queryKey: getListAdminChatsQueryKey(), refetchInterval: THREADS_POLL_MS },
  });
  const transcript = useGetAdminChatTranscript(selected ?? 0, {
    query: {
      queryKey: getGetAdminChatTranscriptQueryKey(selected ?? 0),
      enabled: selected !== null,
      refetchInterval: MESSAGES_POLL_MS,
    },
  });
  const reply = useSendAdminChatMessage();
  const remove = useDeleteAdminChat();
  const confirm = useConfirm();

  const rows = threads.data ?? [];
  // A blocked customer cannot read replies, so the page says so instead of
  // letting an operator write into the void.
  const selectedThread = rows.find(thread => thread.id === selected);
  const selectedBlocked = selectedThread?.customer_blocked ?? false;
  const messages = transcript.data?.messages ?? [];

  // Opening a thread clears its badge server-side, so the list needs refreshing.
  useEffect(() => {
    if (selected === null) return;
    queryClient.invalidateQueries({ queryKey: getListAdminChatsQueryKey() });
  }, [selected, messages.length, queryClient]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, selected]);

  // Another admin may delete the open conversation; when it disappears from
  // the list, close it.
  useEffect(() => {
    if (selected === null || !threads.isSuccess) return;
    if (!rows.some(thread => thread.id === selected)) setSelected(null);
  }, [selected, rows, threads.isSuccess]);

  // Deleting is final: the thread and every message in it are gone, and the
  // customer's next message opens a new, empty conversation.
  const deleteSelected = async () => {
    if (selected === null || remove.isPending) return;
    const who = selectedThread?.customer_name || 'mijoz';
    if (!(await confirm({
      message: `${who} bilan suhbat va undagi barcha xabarlar butunlay o‘chirilsinmi?`,
      confirmLabel: 'O‘chirish',
      danger: true,
    }))) return;
    const id = selected;
    remove.mutate(
      { id },
      {
        onSuccess: () => {
          setSelected(null);
          setDraft('');
          setFailed('');
          queryClient.removeQueries({ queryKey: getGetAdminChatTranscriptQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListAdminChatsQueryKey() });
        },
        onError: () => setFailed('Suhbat o‘chirilmadi. Qaytadan urinib ko‘ring.'),
      },
    );
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || selected === null || reply.isPending || selectedBlocked) return;
    reply.mutate(
      { id: selected, data: { body } },
      {
        onSuccess: () => {
          setDraft('');
          setFailed('');
          queryClient.invalidateQueries({ queryKey: getGetAdminChatTranscriptQueryKey(selected) });
          queryClient.invalidateQueries({ queryKey: getListAdminChatsQueryKey() });
        },
        onError: () => setFailed('Javob yuborilmadi. Qaytadan urinib ko‘ring.'),
      },
    );
  };

  return (
    <div className="container-wide py-7 sm:py-10">
      <div className="mb-8">
        <p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">
          Operator workspace / Suhbatlar
        </p>
        <h1 className="display mt-2 text-4xl font-extrabold sm:text-5xl">Mijozlar bilan yozishma</h1>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
          Har bir suhbat doimiy saqlanadi, buyurtma yetkazilgandan keyin ham davom etadi.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <section className="rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
          {threads.isLoading ? (
            <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="skeleton h-16 rounded-xl" />)}</div>
          ) : rows.length ? (
            <div className="max-h-[70dvh] space-y-1.5 overflow-y-auto">
              {rows.map(thread => (
                <button
                  key={thread.id}
                  type="button"
                  data-testid={`button-chat-thread-${thread.id}`}
                  onClick={() => setSelected(thread.id)}
                  className={`w-full rounded-xl border p-3 text-left transition ${
                    selected === thread.id
                      ? 'border-[hsl(var(--primary))] bg-[#e8efdc]'
                      : 'border-[hsl(var(--border))] hover:border-[hsl(var(--primary)/.4)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex min-w-0 items-center gap-1.5 truncate text-sm font-bold">{thread.customer_name || 'Noma’lum mijoz'}{thread.customer_blocked && <span data-testid={`badge-chat-blocked-${thread.id}`} className="shrink-0 rounded-full bg-[#fdecea] px-1.5 py-0.5 text-[9px] font-bold text-[#8c1d18]">bloklangan</span>}{!thread.customer_blocked && thread.device_blocked && <span data-testid={`badge-chat-device-blocked-${thread.id}`} title="Telegram akkauntining qurilmasi bloklangan: mijoz buyurtma bera olmaydi va yoza olmaydi, lekin javob yozish mumkin" className="shrink-0 rounded-full bg-[#fdecea] px-1.5 py-0.5 text-[9px] font-bold text-[#8c1d18]">qurilmasi bloklangan</span>}</p>
                    {thread.unread_count > 0 && (
                      <span
                        data-testid={`badge-chat-unread-${thread.id}`}
                        className="shrink-0 rounded-full bg-[#e0644f] px-2 py-0.5 text-[10px] font-bold text-white"
                      >
                        {thread.unread_count}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-[hsl(var(--muted-foreground))]">
                    {thread.phone || 'Telefon ko‘rsatilmagan'}
                  </p>
                  {telegramLabel(thread) && <p data-testid={`text-chat-telegram-${thread.id}`} className="mt-0.5 truncate text-[11px] font-semibold text-[#136a93]">Telegram: {telegramProfileUrl(thread) ? <a href={telegramProfileUrl(thread)} target="_blank" rel="noreferrer" className="underline">{telegramLabel(thread)}</a> : telegramLabel(thread)}</p>}
                  <p className="mt-1 truncate text-xs text-[hsl(var(--muted-foreground))]">
                    {thread.last_message || 'Hali xabar yo‘q'}
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <div className="px-3 py-10 text-center">
              <MessageCircle size={22} className="mx-auto text-[hsl(var(--muted-foreground))]" />
              <p className="mt-3 text-sm font-bold">Hali suhbat yo‘q</p>
              <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                Buyurtma bergan mijoz yozganda shu yerda paydo bo‘ladi. Keraksiz suhbatni “Chatni o‘chirish” tugmasi bilan o‘chiring.
              </p>
            </div>
          )}
        </section>

        <section className="flex h-[70dvh] flex-col rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
          {selected === null ? (
            <div className="flex flex-1 items-center justify-center px-6 text-center">
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                Javob yozish uchun chapdan suhbatni tanlang.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-[hsl(var(--border))] px-4 py-3">
                <p className="min-w-0 truncate text-sm font-extrabold">
                  {selectedThread?.customer_name || 'Mijoz'}
                  {selectedThread?.phone ? <span className="ml-2 font-semibold text-[hsl(var(--muted-foreground))]">{selectedThread.phone}</span> : null}
                  {selectedThread && telegramLabel(selectedThread) ? <span className="ml-2 font-semibold text-[#136a93]">{telegramLabel(selectedThread)}</span> : null}
                </p>
                <button
                  type="button"
                  data-testid="button-delete-chat"
                  onClick={deleteSelected}
                  disabled={remove.isPending}
                  className="tap flex shrink-0 items-center gap-1.5 rounded-xl border border-[#e8c4bd] px-3 py-1.5 text-xs font-bold text-[#9d493e] transition hover:bg-[#fdf0ed] disabled:opacity-50"
                >
                  {remove.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  Chatni o‘chirish
                </button>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-4">
                {transcript.isLoading ? (
                  <div className="skeleton h-20 rounded-2xl" />
                ) : messages.length ? (
                  messages.map(message => (
                    <div
                      key={message.id}
                      data-testid={`admin-message-${message.id}`}
                      className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm ${
                        message.sender === 'customer'
                          ? 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]'
                          : 'ml-auto bg-[hsl(var(--primary))] text-white'
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{message.body}</p>
                      <p
                        className={`mt-1 text-[10px] ${
                          message.sender === 'customer'
                            ? 'text-[hsl(var(--muted-foreground))]'
                            : 'text-[#d9e5ce]'
                        }`}
                      >
                        {message.sender === 'operator' && message.admin_name ? `${message.admin_name} · ` : ''}
                        {time(message.created_at)}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="mt-8 text-center text-xs text-[hsl(var(--muted-foreground))]">
                    Bu suhbatda hali xabar yo‘q.
                  </p>
                )}
                <div ref={bottomRef} />
              </div>

              {failed && (
                <p
                  role="status"
                  className="mx-4 mb-2 rounded-xl bg-[#fdf0ed] p-2.5 text-[11px] font-semibold text-[#9d493e]"
                >
                  {failed}
                </p>
              )}

              {selectedBlocked && (
                <p data-testid="text-chat-customer-blocked" className="mx-3 mb-2 rounded-xl bg-[#fdf0ed] p-2.5 text-[11px] font-semibold text-[#9d493e]">
                  Bu mijoz bloklangan va javoblarni o‘qiy olmaydi. Yozish uchun avval «Mijozlar» bo‘limida blokdan chiqaring.
                </p>
              )}
              <form onSubmit={submit} className="flex items-center gap-2 border-t border-[hsl(var(--border))] p-3">
                <input
                  data-testid="input-admin-chat-message"
                  value={draft}
                  onChange={event => setDraft(event.target.value)}
                  placeholder={selectedBlocked ? "Mijoz bloklangan" : "Javob yozing..."}
                  disabled={selectedBlocked}
                  maxLength={1000}
                  className="h-11 min-w-0 flex-1 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-sm outline-none focus:border-[hsl(var(--primary))]"
                />
                <button
                  type="submit"
                  data-testid="button-send-admin-chat"
                  aria-label="Javobni yuborish"
                  disabled={!draft.trim() || reply.isPending || selectedBlocked}
                  className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--primary))] text-white disabled:opacity-50"
                >
                  {reply.isPending ? <LoaderCircle size={17} className="animate-spin" /> : <Send size={17} />}
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
