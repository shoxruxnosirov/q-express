import { useSyncExternalStore } from 'react';

// The site's dark theme is the `dark` class on <html> (see index.css); the
// admin panel the editor came from used data-theme instead. Watched, so the
// code view follows a theme switch while it is open.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

const isDark = () => document.documentElement.classList.contains('dark');

export function useDarkTheme() {
  return useSyncExternalStore(subscribe, isDark, () => false);
}
