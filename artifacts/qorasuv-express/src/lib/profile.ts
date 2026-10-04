import { isCompleteAddress, normalizeAddress, parseAddress, type AddressParts } from './address.ts';
import { translateText, type Lang } from './i18n-text.ts';
import messages from '../i18n/messages/profileErrors.ts';

// The shop has no accounts: orders carry the customer's details directly and
// `users` is never written. So the profile is whatever this browser remembers,
// and its only job is to save the customer retyping the same details on every
// order.

const PROFILE_STORAGE_KEY = 'qorasuv-customer-profile';
// The name used to live alone under this key, written on every keystroke in
// checkout. It is read once so nobody loses the name they already had.
const LEGACY_NAME_STORAGE_KEY = 'qorasuv-customer-name';

// A household orders to a handful of places at most; beyond this the oldest
// is forgotten.
export const MAX_SAVED_ADDRESSES = 5;

export type CustomerProfile = {
  name: string;
  phone: string;
  // Most recently used first. Every entry is complete and currently offered.
  addresses: AddressParts[];
};

export const emptyProfile: CustomerProfile = { name: '', phone: '', addresses: [] };

const asText = (value: unknown) => (typeof value === 'string' ? value : '');

export const sameAddress = (a: AddressParts, b: AddressParts) => a.dom === b.dom && a.xonadon === b.xonadon;

// Drops anything incomplete or no longer offered, removes repeats keeping the
// first (most recent), and caps the list.
export function cleanAddresses(addresses: readonly AddressParts[]) {
  const kept: AddressParts[] = [];
  for (const address of addresses) {
    const normal = normalizeAddress(address);
    if (!isCompleteAddress(normal) || kept.some(existing => sameAddress(existing, normal))) continue;
    kept.push(normal);
    if (kept.length === MAX_SAVED_ADDRESSES) break;
  }
  return kept;
}

// The address an order just went to moves to the front, so it is preselected
// next time.
export function rememberAddress(addresses: readonly AddressParts[], used: AddressParts) {
  return cleanAddresses([used, ...addresses]);
}

export function forgetAddress(addresses: readonly AddressParts[], removed: AddressParts) {
  return addresses.filter(address => !sameAddress(address, removed));
}

function storedAddresses(record: Record<string, unknown>): AddressParts[] {
  if (Array.isArray(record.addresses)) {
    return cleanAddresses(
      record.addresses.map(item => {
        const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
        return { dom: asText(entry.dom), xonadon: asText(entry.xonadon) };
      }),
    );
  }
  // Profiles saved before several addresses held one, either as two fields or,
  // older still, as a typed line under `address`. Either becomes the only
  // entry, so a returning customer keeps it.
  const single =
    record.dom === undefined && record.xonadon === undefined
      ? parseAddress(asText(record.address))
      : { dom: asText(record.dom), xonadon: asText(record.xonadon) };
  return cleanAddresses([single]);
}

export function readProfile(): CustomerProfile {
  try {
    const stored = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        return { name: asText(record.name), phone: asText(record.phone), addresses: storedAddresses(record) };
      }
    }
    return { ...emptyProfile, name: localStorage.getItem(LEGACY_NAME_STORAGE_KEY) || '' };
  } catch {
    // Private windows and blocked site data both throw here. A customer with
    // no storage simply fills the checkout form in by hand, as before.
    return { ...emptyProfile, addresses: [] };
  }
}

export function writeProfile(profile: CustomerProfile) {
  const trimmed: CustomerProfile = {
    name: profile.name.trim(),
    phone: profile.phone.trim(),
    addresses: cleanAddresses(profile.addresses),
  };
  try {
    // The first address is also written as dom/xonadon, so a tab still running
    // the previous bundle reads the latest address rather than nothing.
    const [latest] = trimmed.addresses;
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ ...trimmed, dom: latest?.dom ?? '', xonadon: latest?.xonadon ?? '' }));
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
export function profileFieldError(profile: Pick<CustomerProfile, 'name' | 'phone'>, lang: Lang = 'uz') {
  if (profile.name.trim() && profile.name.trim().length < 2) return translateText(messages, lang, 'nameShort');
  if (profile.phone.trim() && profile.phone.trim().length < 7) return translateText(messages, lang, 'phoneShort');
  return '';
}
