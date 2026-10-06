import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';

// The browser's window.confirm, prompt and alert are not shown in every
// Telegram webview, and a dialog that never appears reads as "no": the button
// just seems dead. These are drawn by the page, so they look and work the same
// everywhere.

type ConfirmOptions = {
  message: string;
  confirmLabel?: string;
  // A red button, for what cannot be undone.
  danger?: boolean;
};

type AskOptions = ConfirmOptions & {
  inputLabel: string;
  maxLength?: number;
};

// One dialog serves both: an answer is the typed text (empty for a plain
// confirm) or null for "no".
type Pending = ConfirmOptions & { inputLabel?: string; maxLength?: number; notice?: boolean };

type Dialogs = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  ask: (options: AskOptions) => Promise<string | null>;
  notify: (message: string) => Promise<void>;
};

const ConfirmContext = createContext<Dialogs | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  // Held apart from state so a second answer (a click racing Esc) is ignored.
  const resolveRef = useRef<((answer: string | null) => void) | null>(null);

  const open = useCallback((options: Pending) => new Promise<string | null>(resolve => {
    // A new question while one is open answers the old one "no".
    resolveRef.current?.(null);
    resolveRef.current = resolve;
    setText('');
    setPending(options);
  }), []);

  const dialogs = useRef<Dialogs>({
    confirm: async options => (await open(options)) !== null,
    ask: options => open(options),
    notify: async message => { await open({ message, notice: true, confirmLabel: 'Tushunarli' }); },
  }).current;

  const answer = (value: string | null) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setPending(null);
    resolve?.(value);
  };

  return (
    <ConfirmContext.Provider value={dialogs}>
      {children}
      <AlertDialog.Root open={pending !== null} onOpenChange={isOpen => { if (!isOpen) answer(null); }}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[70] bg-[hsl(var(--foreground)/.4)] backdrop-blur-sm" />
          <AlertDialog.Content
            data-testid="confirm-dialog"
            // A question that wants a reason starts in its text field; a
            // notice, which has no "Bekor qilish", on its one button; the
            // others on "Bekor qilish", so a stray Enter does nothing.
            onOpenAutoFocus={event => {
              const target = inputRef.current ?? (pending?.notice ? okRef.current : null);
              if (!target) return;
              event.preventDefault();
              target.focus();
            }}
            className="fixed left-1/2 top-1/2 z-[70] w-[calc(100%-32px)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-[0_24px_48px_rgba(0,0,0,.2)]"
          >
            <AlertDialog.Title className="text-base font-extrabold">{pending?.notice ? 'Diqqat' : 'Tasdiqlang'}</AlertDialog.Title>
            <AlertDialog.Description className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
              {pending?.message}
            </AlertDialog.Description>
            {pending?.inputLabel !== undefined && (
              <label className="mt-4 block text-xs font-bold">
                {pending.inputLabel}
                <textarea
                  ref={inputRef}
                  data-testid="input-confirm-text"
                  value={text}
                  maxLength={pending.maxLength}
                  rows={2}
                  onChange={event => setText(event.target.value)}
                  className="mt-1.5 w-full resize-none rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm font-normal outline-none focus:border-[hsl(var(--primary))]"
                />
                {pending.maxLength !== undefined && (
                  <span className="mt-1 block text-right text-[10px] font-normal text-[hsl(var(--muted-foreground))]">
                    {text.length} / {pending.maxLength}
                  </span>
                )}
              </label>
            )}
            <div className="mt-5 flex justify-end gap-2">
              {!pending?.notice && (
                <AlertDialog.Cancel
                  data-testid="button-confirm-cancel"
                  className="tap h-11 rounded-xl border border-[hsl(var(--border))] px-4 text-xs font-bold"
                >
                  Bekor qilish
                </AlertDialog.Cancel>
              )}
              <AlertDialog.Action
                ref={okRef}
                data-testid="button-confirm-ok"
                onClick={() => answer(text)}
                className={`tap h-11 rounded-xl px-4 text-xs font-extrabold text-white ${
                  pending?.danger ? 'bg-[#b3261e]' : 'bg-[hsl(var(--primary))]'
                }`}
              >
                {pending?.confirmLabel ?? 'Ha'}
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </ConfirmContext.Provider>
  );
}

function useDialogs() {
  const dialogs = useContext(ConfirmContext);
  if (!dialogs) throw new Error('useConfirm must be used inside ConfirmProvider');
  return dialogs;
}

// Resolves true for "yes", false for "no".
export const useConfirm = () => useDialogs().confirm;

// Resolves the typed text for "yes" (possibly empty), null for "no".
export const useAsk = () => useDialogs().ask;

// A message with one button, in place of window.alert.
export const useNotify = () => useDialogs().notify;
