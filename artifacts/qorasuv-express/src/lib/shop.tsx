import { createContext, useContext, type ReactNode } from 'react';
import { getListShopsQueryKey, useListShops, type Shop } from '@workspace/api-client-react';

// The platform runs several shops. Q express, the platform's own, lives at the
// root of the site; every other shop under /s/<slug>, with the same pages.
// The storefront pages ask the API about "their" shop with ?shop=<slug>; for
// Q express the parameter is left out, so its requests are exactly what they
// were before there were shops.

export const PLATFORM_SHOP_ID = 1;

const ShopSlugContext = createContext<string | null>(null);

// Wraps the storefront of one shop. `slug` is null for Q express.
export function ShopScope({ slug, children }: { slug: string | null; children: ReactNode }) {
  return <ShopSlugContext.Provider value={slug}>{children}</ShopSlugContext.Provider>;
}

export function useShops() {
  return useListShops({ query: { queryKey: getListShopsQueryKey(), staleTime: 5 * 60_000 } });
}

// The ?shop= parameter of a shop's requests: none for Q express.
export function shopParams(slug: string | null | undefined): { shop: string } | undefined {
  return slug ? { shop: slug } : undefined;
}

// Where a shop's pages start: "" for Q express, "/s/<slug>" for the others.
// Absolute ("~"), for links that leave the current shop.
export function shopHref(shop: Pick<Shop, 'slug' | 'is_platform'>, path = '/') {
  const base = shop.is_platform ? '' : `/s/${shop.slug}`;
  return `~${base}${path === '/' && base ? '' : path}`;
}

export function useShop() {
  const slug = useContext(ShopSlugContext);
  const shops = useShops();
  const list = shops.data ?? [];
  const shop = slug ? list.find(item => item.slug === slug) : list.find(item => item.is_platform);
  return {
    slug,
    shop,
    shops: list,
    isPlatform: slug === null,
    params: shopParams(slug),
    // A slug no shop has (or a hidden shop) once the list has arrived.
    missing: slug !== null && shops.isSuccess && !shop,
    loading: shops.isLoading,
    // The list could not be read, even after the client's retries. The pages
    // then offer to try again instead of waiting for ever.
    failed: shops.isError,
    retry: () => void shops.refetch(),
    // The shop's id, known for Q express before the list arrives.
    shopId: slug === null ? PLATFORM_SHOP_ID : shop?.id,
  };
}

// The shop a product belongs to. Products saved in a cart before shops
// existed carry no shop and are Q express's.
export function productShopId(product: { shop_id?: number }) {
  return product.shop_id ?? PLATFORM_SHOP_ID;
}
