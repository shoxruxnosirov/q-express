// Pure stock rules for the storefront, kept free of React so node --test can
// load them directly.

import { translateText, type Lang } from './i18n-text.ts';
import messages from '../i18n/messages/stockRules.ts';
import { unitLabel } from '../i18n/messages/units.ts';

type Stocked = { id: number; stock: number };
type Line = { productId: number; quantity: number };

export const isSoldOut = (product: { stock: number }) => product.stock <= 0;

// Sold-out products stay listed, so a customer can see the shop carries them,
// but after everything they can actually buy. Stable, so the server's order
// (popular, price, newest...) holds within each group.
export function inStockFirst<T extends { stock: number }>(products: readonly T[]) {
  return [...products].sort((a, b) => Number(isSoldOut(a)) - Number(isSoldOut(b)));
}

// Quantities are decimals (0.1 + 0.2 kg is 0.30000000000000004 in floating
// point), and stock is stored to six places, so anything closer than that is
// the same amount.
const QUANTITY_TOLERANCE = 1e-6;

export type LineProblem = { kind: 'gone' } | { kind: 'sold-out' } | { kind: 'short'; available: number };

// The cart keeps each product as it was when added, so its stock goes stale.
// Checks every line against the live catalog, where a hidden or deleted
// product no longer appears at all.
export function findLineProblems(lines: readonly Line[], catalog: readonly Stocked[]) {
  const live = new Map(catalog.map(product => [product.id, product]));
  const problems = new Map<number, LineProblem>();
  for (const line of lines) {
    const product = live.get(line.productId);
    if (!product) problems.set(line.productId, { kind: 'gone' });
    else if (isSoldOut(product)) problems.set(line.productId, { kind: 'sold-out' });
    else if (line.quantity > product.stock + QUANTITY_TOLERANCE) problems.set(line.productId, { kind: 'short', available: product.stock });
  }
  return problems;
}

// `unit` is the product's unit as stored (dona, kg...); it is shown in the
// reader's language.
export function lineProblemText(problem: LineProblem, unit: string, lang: Lang = 'uz') {
  if (problem.kind === 'gone') return translateText(messages, lang, 'gone');
  if (problem.kind === 'sold-out') return translateText(messages, lang, 'soldOut');
  return translateText(messages, lang, 'short', { available: problem.available, unit: unitLabel(unit, lang) });
}
