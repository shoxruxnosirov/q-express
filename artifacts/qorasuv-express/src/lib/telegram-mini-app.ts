// The shop also runs as a Telegram Mini App, opened from the bot's buttons.
//
// No Telegram script is loaded. Everything this app needs is two documented
// pieces of the platform (core.telegram.org/api/web-events):
// - Telegram passes its signed launch data in the URL fragment, as the
//   tgWebAppData parameter;
// - the page talks back by posting events: TelegramWebviewProxy.postEvent on
//   the phone and desktop apps, postMessage to the parent frame on the web.
// Loading telegram-web-app.js for this made the page wait on telegram.org,
// and injecting it with document.write let Chrome block it on slow networks,
// which silently turned off signing in.

const INIT_DATA_KEY = 'qorasuv-tg-init-data';

type Bridge = {
  TelegramWebviewProxy?: { postEvent: (eventType: string, eventData: string | undefined) => void };
  external?: { notify?: (message: string) => void };
  parent: { postMessage: (message: string, targetOrigin: string) => void };
};

// Read once, when the module loads: navigating inside the app replaces the
// URL, and a reload inside Telegram can drop the fragment, so the launch data
// is also kept for the rest of this tab's life.
function captureInitData(location: { hash: string }, storage: Pick<Storage, 'getItem' | 'setItem'> | undefined) {
  const fromHash = new URLSearchParams(location.hash.replace(/^#/, '')).get('tgWebAppData') ?? '';
  try {
    if (fromHash) storage?.setItem(INIT_DATA_KEY, fromHash);
    else return storage?.getItem(INIT_DATA_KEY) ?? '';
  } catch {
    // Storage may be unavailable; the fragment alone still works on launch.
  }
  return fromHash;
}

function sessionStore() {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

let initData = typeof window === 'undefined' ? '' : captureInitData(window.location, sessionStore());

// The signed launch data, or '' outside Telegram.
export function telegramInitData() {
  return initData;
}

export function isMiniApp() {
  return initData !== '';
}

// Sends one event to the Telegram client that opened the page. Shaped exactly
// as Telegram's own library sends it: an event with no payload carries none
// (JSON.stringify(undefined) is undefined, and the key drops out on the web).
export function postEvent(eventType: string, eventData?: Record<string, unknown>, target: Bridge = window as unknown as Bridge) {
  try {
    if (target.TelegramWebviewProxy?.postEvent) {
      target.TelegramWebviewProxy.postEvent(eventType, JSON.stringify(eventData));
    } else if (target.external?.notify) {
      target.external.notify(JSON.stringify({ eventType, eventData }));
    } else {
      // Telegram Web hosts the app in an iframe. Nothing secret is sent, so
      // any parent may read it, as Telegram's own library does.
      target.parent.postMessage(JSON.stringify({ eventType, eventData }), '*');
    }
  } catch {
    // An older client that does not know an event simply ignores the shop's
    // request; the page works regardless.
  }
}

// Tells Telegram the page is ready and opens it at full height, in the shop's
// colours rather than Telegram's default white bar. Runs at once, with no
// script to wait for.
export function startMiniApp() {
  if (!isMiniApp()) return;
  postEvent('web_app_ready');
  postEvent('web_app_expand');
  postEvent('web_app_set_header_color', { color: '#1f6657' });
  postEvent('web_app_set_background_color', { color: '#f7f4ec' });
}

// Inside the Mini App a t.me link switches to that chat in Telegram rather
// than opening a browser tab on top of the shop.
export function openTelegramLink(url: string) {
  if (!isMiniApp()) return false;
  const link = new URL(url);
  if (link.hostname !== 't.me') return false;
  postEvent('web_app_open_tg_link', { path_full: link.pathname + link.search });
  return true;
}

// For tests only.
export const __test = {
  captureInitData,
  setInitData: (value: string) => { initData = value; },
};
