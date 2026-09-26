// The shop also runs as a Telegram Mini App, opened from the bot's buttons.
// telegram-web-app.js (loaded in index.html) exposes window.Telegram.WebApp
// there; in an ordinary browser it exists but carries no initData.

type TelegramWebApp = {
  initData: string;
  ready: () => void;
  expand: () => void;
  openTelegramLink?: (url: string) => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
};

export function miniApp(): TelegramWebApp | undefined {
  const app = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
  return app && app.initData ? app : undefined;
}

// Tells Telegram the page is ready and opens it at full height, in the shop's
// colours rather than Telegram's default white bar.
export function startMiniApp() {
  const app = miniApp();
  if (!app) return;
  try {
    app.ready();
    app.expand();
    app.setHeaderColor?.('#1f6657');
    app.setBackgroundColor?.('#f7f4ec');
  } catch {
    // An older Telegram without these calls still shows the shop.
  }
}

// Inside the Mini App a t.me link should switch to the bot's chat rather than
// open a browser tab on top of the shop.
export function openTelegramLink(url: string) {
  const app = miniApp();
  if (app?.openTelegramLink) {
    app.openTelegramLink(url);
    return true;
  }
  return false;
}
