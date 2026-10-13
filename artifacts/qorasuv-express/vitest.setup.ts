import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// The interface language the tests read their labels in: Uzbek, as on the
// admin pages. jsdom's navigator says en-US, which the shop would otherwise
// pick on a first visit (src/i18n/index.tsx reads this before any test runs).
try {
  localStorage.setItem('qorasuv-lang', 'uz');
} catch {
  // No storage: the shop falls back to the browser's language.
}

// Jest (where these tests came from) unmounted after each test on its own.
afterEach(() => cleanup());
