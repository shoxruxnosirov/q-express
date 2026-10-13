import { createRoot } from 'react-dom/client';

import { setAuthTokenGetter, setExtraHeadersGetter } from '@workspace/api-client-react';
import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { launchStartPath, miniAppSessionToken } from '@/lib/telegram-mini-app';
import { getCurrentLang, LanguageProvider } from '@/i18n';
import { actingShopHeader } from '@/lib/admin-shop';

import './index.css';

// Inside the Mini App every API call carries the session as a bearer header,
// since Telegram Web runs the shop in a frame where the cookie may be
// refused. Outside Telegram the getter answers null and the cookie is used.
setAuthTokenGetter(miniAppSessionToken);
// Opened from another shop's bot: go straight to that shop's page. The launch
// data was already kept when telegram-mini-app loaded, so dropping the
// fragment here loses nothing.
const startPath = launchStartPath();
if (startPath && window.location.pathname === '/') window.history.replaceState(null, '', startPath);
// Every call says which language the customer is reading, so the server's
// messages (a sold-out product, a closed shop) come back in it.
// The admin pages stay Uzbek, whatever the storefront was last shown in.
// A platform super admin working in another shop names it on every call.
setExtraHeadersGetter(() => (window.location.pathname.startsWith('/admin')
  ? { 'x-lang': 'uz', ...actingShopHeader() }
  : { 'x-lang': getCurrentLang() }));

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
