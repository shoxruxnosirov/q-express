import { emptyAddress, normalizeAddress, parseAddress, type AddressParts } from './address.ts';

// The shop has no accounts: orders carry the customer's details directly and
// `users` is never written. So the profile is whatever this browser remembers,
// and its only job is to save the customer retyping the same details on every
// order.

const PROFILE_STORAGE_KEY = 'qorasuv-customer-profile';
// The name used to live alone under this key, written on every keystroke in
// checkout. It is read once so nobody loses the name they already had.
const LEGACY_NAME_STORAGE_KEY = 'qorasuv-customer-name';

export type CustomerProfile = AddressParts & {
  name: string;
  phone: string;
};

export const emptyProfile: CustomerProfile = { name: '', phone: '', ...emptyAddress };

const asText = (value: unknown) => (typeof value === 'string' ? value : '');

export function readProfile(): CustomerProfile {
  try {
    const stored = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        // Profiles written before the address became two selects hold a typed
        // line under `address`. Recover the numbers from it rather than making
        // a returning customer pick them again.
        const address =
          record.dom === undefined && record.xonadon === undefined
            ? parseAddress(asText(record.address))
            : normalizeAddress({ dom: asText(record.dom), xonadon: asText(record.xonadon) });
        return { name: asText(record.name), phone: asText(record.phone), ...address };
      }
    }
    return { ...emptyProfile, name: localStorage.getItem(LEGACY_NAME_STORAGE_KEY) || '' };
  } catch {
    // Private windows and blocked site data both throw here. A customer with
    // no storage simply fills the checkout form in by hand, as before.
    return { ...emptyProfile };
  }
}

export function writeProfile(profile: CustomerProfile) {
  const trimmed: CustomerProfile = {
    name: profile.name.trim(),
    phone: profile.phone.trim(),
    ...normalizeAddress(profile),
  };
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(trimmed));
    // Kept in step so an older tab still showing the previous bundle does not
    // hand back a stale name.
    localStorage.setItem(LEGACY_NAME_STORAGE_KEY, trimmed.name);
  } catch {
    // ignore
  }
  return trimmed;
}

export function clearProfile() {
  try {
    localStorage.removeItem(PROFILE_STORAGE_KEY);
    localStorage.removeItem(LEGACY_NAME_STORAGE_KEY);
  } catch {
    // ignore
  }
}

// Checkout will not accept an order below these thresholds, so the profile
// applies the same rules rather than storing something that cannot be used.
// The address needs no rule of its own: a select can only hold an offered
// value or nothing at all.
export function profileFieldError(profile: CustomerProfile) {
  if (profile.name.trim() && profile.name.trim().length < 2) return 'Ism kamida 2 ta harf bo‘lsin.';
  if (profile.phone.trim() && profile.phone.trim().length < 7) return 'Telefon raqam to‘liq emas.';
  return '';
}
