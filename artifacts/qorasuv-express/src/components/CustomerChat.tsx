import { type FormEvent, useEffect, useRef, useState } from 'react';
import { LoaderCircle, MessageCircle, Send, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetChatTranscriptQueryKey,
  useGetChatTranscript,
  useSendChatMessage,
  useStartChatSession,
} from '@workspace/api-client-react';
import { readProfile } from '@/lib/profile';

// Polling rather than a socket: the free instance sleeps after fifteen idle
// minutes, so a long-lived connection would spend its life reconnecting. Open
// panels poll briskly, a closed one just often enough to raise the dot.
const OPEN_POLL_MS = 5000;
const CLOSED_POLL_MS = 30000;
// The browser cannot read the httpOnly session cookie, so this non-secret flag
// records that a conversation exists and is worth polling for.
const STARTED_FLAG = 'qorasuv-chat-started';
const SEEN_MESSAGE_KEY = 'qorasuv-chat-seen-id';

const readNumber = (key: string) => {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
};
const writeValue = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable; the chat still works, it just re-announces.
  }
};
const hasStarted = () => {
  try {
    return localStorage.getItem(STARTED_FLAG) === '1';
  } catch {
    return false;
  }
};
const forgetStarted = () => {
  try {
    localStorage.removeItem(STARTED_FLAG);
  } catch {
    // ignore
  }
};

const time = (value: string) =>
  new Intl.DateTimeFormat('uz-UZ', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));

export function CustomerChat() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(hasStarted);
  const [draft, setDraft] = useState('');
  const [failed, setFailed] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const startSession = useStartChatSession();
  const sendMessage = useSendChatMessage();
  const transcript = useGetChatTranscript({
    query: {
      queryKey: getGetChatTranscriptQueryKey(),
      enabled: started,
      refetchInterval: open ? OPEN_POLL_MS : CLOSED_POLL_MS,
      // A browser whose conversation was cleared server-side should stop asking.
      retry: false,
    },
  });

  const messages = transcript.data?.messages ?? [];
  const lastOperatorId = [...messages].reverse().find(message => message.sender === 'operator')?.id ?? 0;
  const [seenId, setSeenId] = useState(() => readNumber(SEEN_MESSAGE_KEY));
  const unread = !open && lastOperatorId > seenId;

  // Opening starts the conversation if this browser has none yet. The call is
  // idempotent, so a returning customer lands back in the same thread.
  //
  // The ref, not `isPending`, is what makes this run once. React Query only
  // flips isPending on a later render, and the mutation object is a new
  // identity each render, so a re-render in that window would fire a second
  // request. That second request would still carry no cookie and would open a
  // second thread, leaving the customer talking in one while the operator
  // answers in the other.
  const starting = useRef(false);
  useEffect(() => {
    if (!open || started || starting.current) return;
    starting.current = true;
    const profile = readProfile();
    startSession.mutate(
      { data: { name: profile.name, phone: profile.phone } },
      {
        onSuccess: () => {
          writeValue(STARTED_FLAG, '1');
          setStarted(true);
          setFailed('');
        },
        onError: () => setFailed('Suhbatni ochib bo‘lmadi. Keyinroq urinib ko‘ring.'),
        onSettled: () => {
          starting.current = false;
        },
      },
    );
    // `startSession` is deliberately not a dependency: it changes identity on
    // every render and the ref above already guarantees a single call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, started]);

  // The cookie and this flag have different lifetimes: cookies can be cleared,
  // or expire, while localStorage survives. Left alone, the transcript would
  // then answer 404 forever and the customer could never send anything again.
  // Dropping the flag re-opens the session, which resumes the same thread when
  // the cookie is in fact fine, so a transient failure costs one request.
  useEffect(() => {
    if (!started || !transcript.isError) return;
    forgetStarted();
    setStarted(false);
  }, [started, transcript.isError]);

  // Reading the thread is what clears the dot.
  useEffect(() => {
    if (!open || !lastOperatorId) return;
    setSeenId(lastOperatorId);
    writeValue(SEEN_MESSAGE_KEY, String(lastOperatorId));
  }, [open, lastOperatorId]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [open, messages.length]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !started || sendMessage.isPending) return;
    sendMessage.mutate(
      { data: { body } },
      {
        onSuccess: () => {
          setDraft('');
          setFailed('');
          queryClient.invalidateQueries({ queryKey: getGetChatTranscriptQueryKey() });
        },
        onError: () => setFailed('Xabar yuborilmadi. Qaytadan urinib ko‘ring.'),
      },
    );
  };

  if (!open) {
    return (
      <button
        type="button"
        data-testid="button-open-chat"
        aria-label="Do‘kon bilan bog‘lanish"
        onClick={() => setOpen(true)}
        className="tap fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-white shadow-[0_12px_28px_rgba(22,116,96,.32)] transition hover:scale-105"
      >
        <MessageCircle size={22} />
        {unread && (
          <span
            data-testid="badge-chat-unread"
            className="absolute right-1 top-1 h-3.5 w-3.5 rounded-full border-2 border-white bg-[#e0644f]"
          />
        )}
      </button>
    );
  }

  return (
    <div
      data-testid="panel-chat"
      className="fixed bottom-5 right-5 z-40 flex h-[min(520px,75dvh)] w-[min(360px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-[0_18px_48px_rgba(20,40,34,.22)]"
    >
      <div className="flex items-center justify-between gap-3 bg-[hsl(var(--primary))] px-4 py-3 text-white">
        <div>
          <p className="text-sm font-extrabold">Do‘kon bilan suhbat</p>
          <p className="text-[11px] text-[#d9e5ce]">Savolingizni yozing, operator javob beradi.</p>
        </div>
        <button
          type="button"
          data-testid="button-close-chat"
          aria-label="Suhbatni yopish"
          onClick={() => setOpen(false)}
          className="tap rounded-lg p-1.5 transition hover:bg-white/15"
        >
          <X size={17} />
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {startSession.isPending || (transcript.isLoading && started) ? (
          <div className="skeleton h-16 rounded-2xl" />
        ) : messages.length ? (
          messages.map(message => (
            <div
              key={message.id}
              data-testid={`message-${message.id}`}
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${
                message.sender === 'operator'
                  ? 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]'
                  : 'ml-auto bg-[hsl(var(--primary))] text-white'
              }`}
            >
              <p className="whitespace-pre-wrap break-words">{message.body}</p>
              <p
                className={`mt-1 text-[10px] ${
                  message.sender === 'operator' ? 'text-[hsl(var(--muted-foreground))]' : 'text-[#d9e5ce]'
                }`}
              >
                {time(message.created_at)}
              </p>
            </div>
          ))
        ) : (
          <p className="mt-6 text-center text-xs text-[hsl(var(--muted-foreground))]">
            Hali xabar yo‘q. Buyurtmangiz yoki mahsulotlar haqida so‘rang.
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      {failed && (
        <p role="status" className="mx-4 mb-2 rounded-xl bg-[#fdf0ed] p-2.5 text-[11px] font-semibold text-[#9d493e]">
          {failed}
        </p>
      )}

      <form onSubmit={submit} className="flex items-center gap-2 border-t border-[hsl(var(--border))] p-3">
        <input
          data-testid="input-chat-message"
          value={draft}
          onChange={event => setDraft(event.target.value)}
          placeholder="Xabar yozing..."
          maxLength={1000}
          disabled={!started}
          className="h-11 min-w-0 flex-1 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-sm outline-none focus:border-[hsl(var(--primary))] disabled:opacity-60"
        />
        <button
          type="submit"
          data-testid="button-send-chat"
          aria-label="Xabarni yuborish"
          disabled={!started || !draft.trim() || sendMessage.isPending}
          className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--primary))] text-white disabled:opacity-50"
        >
          {sendMessage.isPending ? <LoaderCircle size={17} className="animate-spin" /> : <Send size={17} />}
        </button>
      </form>
    </div>
  );
}
