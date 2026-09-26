import { getListProductsQueryKey, useListProducts } from '@workspace/api-client-react';
import type { CartLine } from './cart';
import { findLineProblems, type LineProblem } from './stock-rules';

export { inStockFirst, isSoldOut, lineProblemText } from './stock-rules';

// Checks the cart against the live catalog. Until the catalog has loaded,
// nothing is flagged, so a slow network never blocks checkout on a guess.
export function useCartAvailability(lines: readonly CartLine[]) {
  const catalog = useListProducts(undefined, {
    query: { queryKey: getListProductsQueryKey(), enabled: lines.length > 0, refetchOnWindowFocus: true },
  });
  const problems = catalog.data ? findLineProblems(lines, catalog.data) : new Map<number, LineProblem>();
  // live: the current product, for editing a line against today's stock.
  const live = new Map((catalog.data ?? []).map(product => [product.id, product]));
  return { problems, live, checking: catalog.isLoading };
}
