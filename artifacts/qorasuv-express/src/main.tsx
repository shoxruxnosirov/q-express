import { createRoot } from 'react-dom/client';

import { setAuthTokenGetter } from '@workspace/api-client-react';
import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { miniAppSessionToken } from '@/lib/telegram-mini-app';

import './index.css';

// Inside the Mini App every API call carries the session as a bearer header,
// since Telegram Web runs the shop in a frame where the cookie may be
// refused. Outside Telegram the getter answers null and the cookie is used.
setAuthTokenGetter(miniAppSessionToken);

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
