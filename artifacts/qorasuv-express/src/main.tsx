import { createRoot } from 'react-dom/client';

import { setAuthTokenGetter, setExtraHeadersGetter } from '@workspace/api-client-react';
import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { miniAppSessionToken } from '@/lib/telegram-mini-app';
import { getCurrentLang, LanguageProvider } from '@/i18n';

import './index.css';

// Inside the Mini App every API call carries the session as a bearer header,
// since Telegram Web runs the shop in a frame where the cookie may be
// refused. Outside Telegram the getter answers null and the cookie is used.
setAuthTokenGetter(miniAppSessionToken);
// Every call says which language the customer is reading, so the server's
// messages (a sold-out product, a closed shop) come back in it.
// The admin pages stay Uzbek, whatever the storefront was last shown in.
setExtraHeadersGetter(() => ({ 'x-lang': window.location.pathname.startsWith('/admin') ? 'uz' : getCurrentLang() }));

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </ErrorBoundary>,
);
