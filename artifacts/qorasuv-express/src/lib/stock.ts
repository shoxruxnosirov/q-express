import { useQueries } from '@tanstack/react-query';
import { getListProductsQueryOptions, type Product } from '@workspace/api-client-react';
import type { CartLine } from './cart';
import { productShopId, shopParams, useShops } from './shop';
import { findLineProblems, type LineProblem } from './stock-rules';

export { inStockFirst, isSoldOut, lineProblemText } from './stock-rules';

// Checks the cart against the live catalog of every shop it holds products
// from. Until a shop's catalog has loaded, its lines are not flagged, so a
// slow network never blocks checkout on a guess. Lines of a shop that is no
// longer listed are left to the cart's own "shop gone" notice.
export function useCartAvailability(lines: readonly CartLine[]) {
  const shops = useShops();
  const list = shops.data ?? [];
  const shopIds = [...new Set(lines.map(line => productShopId(line.product)))];
  const known = shopIds.flatMap(id => {
    const shop = list.find(item => item.id === id);
    return shop ? [shop] : [];
  });
  const catalogs = useQueries({
    queries: known.map(shop => {
      const params = shopParams(shop.is_platform ? null : shop.slug);
      return { ...getListProductsQueryOptions(params), refetchOnWindowFocus: true };
    }),
  });
  const problems = new Map<number, LineProblem>();
  const live = new Map<number, Product>();
  known.forEach((shop, index) => {
    const data = catalogs[index]?.data;
    if (!data) return;
    const shopLines = lines.filter(line => productShopId(line.product) === shop.id);
    for (const [id, problem] of findLineProblems(shopLines, data)) problems.set(id, problem);
    // live: the current product, for editing a line against today's stock.
    for (const product of data) live.set(product.id, product);
  });
  return { problems, live, checking: shops.isLoading || catalogs.some(catalog => catalog.isLoading) };
}
