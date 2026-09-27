import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetChatTranscriptQueryKey,
  getGetCustomerProfileQueryKey,
  getListOrdersQueryKey,
  useSignInWithTelegram,
} from '@workspace/api-client-react';
import { isMiniApp, startMiniApp, telegramInitData } from '@/lib/telegram-mini-app';

// Opened as a Mini App, the shop hands Telegram's signed initData to the
// server once. A customer who verified their phone earlier is then signed in
// here without doing anything; anyone else carries on as before.
export function TelegramSignIn() {
  const qc = useQueryClient();
  const signIn = useSignInWithTelegram();
  const attempted = useRef(false);

  useEffect(() => {
    if (!isMiniApp() || attempted.current) return;
    attempted.current = true;
    startMiniApp();
    signIn.mutate({ data: { init_data: telegramInitData() } }, {
      onSuccess: profile => {
        qc.setQueryData(getGetCustomerProfileQueryKey(), profile);
        if (profile.authenticated) {
          qc.invalidateQueries({ queryKey: getListOrdersQueryKey() });
          qc.invalidateQueries({ queryKey: getGetChatTranscriptQueryKey() });
          qc.invalidateQueries({ predicate: query => String(query.queryKey[0]).startsWith('/api/orders/delivery-fee') });
        }
      },
    });
  }, [qc, signIn]);

  return null;
}
