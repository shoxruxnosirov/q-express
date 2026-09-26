// Delivery addresses are picked, not typed: the shop serves a known set of
// blocks, and a free-typed line produced unreachable addresses and typos that
// the courier had to chase by phone.
//
// THESE TWO LISTS ARE THE SHOP'S CONFIGURATION. They are plain ranges to start
// with, and they are meant to be edited down to the buildings actually served,
// or replaced with an explicit list such as ['1', '2', '5', '12A']. Nothing
// else in the app needs to change when they do.
const range = (count: number) => Array.from({ length: count }, (_, index) => String(index + 1));

export const DOM_OPTIONS = range(200);
export const XONADON_OPTIONS = range(100);

export type AddressParts = { dom: string; xonadon: string };

export const emptyAddress: AddressParts = { dom: '', xonadon: '' };

// A value that is no longer offered must not survive, or a select would be
// asked to show an option it does not have.
export function normalizeAddress(parts: AddressParts): AddressParts {
  return {
    dom: DOM_OPTIONS.includes(parts.dom) ? parts.dom : '',
    xonadon: XONADON_OPTIONS.includes(parts.xonadon) ? parts.xonadon : '',
  };
}

export function isCompleteAddress(parts: AddressParts) {
  return parts.dom !== '' && parts.xonadon !== '';
}

// The single line the order carries and the Telegram notification prints. The
// server stores `address` as free text, so the shape lives here rather than in
// the API contract.
export function formatAddress(parts: AddressParts) {
  return isCompleteAddress(parts) ? `${parts.dom}-dom, ${parts.xonadon}-xonadon` : '';
}

// Profiles saved before the selects existed hold a typed line. Recover the two
// numbers when it has the shape this app writes, so a returning customer keeps
// their address instead of starting over. Anything else, including a genuine
// street address, yields empty selects and is simply re-picked.
const ADDRESS_PATTERN = /^\s*(\d+)\s*-?\s*dom\s*[,\s]\s*(\d+)\s*-?\s*xonadon\s*$/i;

export function parseAddress(address: string): AddressParts {
  const match = ADDRESS_PATTERN.exec(address);
  if (!match) return { ...emptyAddress };
  const [, dom, xonadon] = match;
  return normalizeAddress({ dom, xonadon });
}
