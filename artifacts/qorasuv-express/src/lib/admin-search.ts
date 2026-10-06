// Finding things in the admin catalog, kept free of React so node --test can
// load it directly. The list is already in the browser, so filtering here
// costs no request and answers on every keystroke.

import { toLatin } from '../i18n/translit.ts';

// The same product is typed "Go‘sht", "go'sht", "gosht" or "гўшт": all of them
// become "gosht". Uzbek apostrophes are dropped rather than unified, because
// people leave them out as often as they type them.
export function searchKey(text: string) {
  return toLatin(text).toLowerCase().replace(/[‘’ʻʼ'`]/g, '').replace(/\s+/g, ' ').trim();
}

// Every word of the query has to appear somewhere in the fields, in any order,
// so "litr sut" finds "Sut 1 litr".
export function matchesSearch(query: string, ...fields: Array<string | null | undefined>) {
  const words = searchKey(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fields.map(field => searchKey(field ?? '')).join(' ');
  return words.every(word => haystack.includes(word));
}

// The dashboard's "zaxira kam" counts products on the site at or under this.
export const LOW_STOCK = 5;

export const PRODUCT_STATUSES = ['all', 'visible', 'hidden', 'sold-out', 'low'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

type FilterableProduct = {
  name: string;
  description: string;
  category: string;
  category_id: number;
  active: boolean;
  stock: number;
};

// A product is on the site only when it and its category both are.
export function productHasStatus(product: FilterableProduct, status: ProductStatus, hiddenCategories: ReadonlySet<number> = new Set()) {
  const onSite = product.active && !hiddenCategories.has(product.category_id);
  switch (status) {
    case 'visible': return onSite;
    case 'hidden': return !onSite;
    case 'sold-out': return product.stock <= 0;
    case 'low': return onSite && product.stock <= LOW_STOCK;
    default: return true;
  }
}

export function filterAdminProducts<T extends FilterableProduct>(
  products: T[],
  {
    search = '',
    categoryId = null,
    status = 'all',
    hiddenCategories,
  }: { search?: string; categoryId?: number | null; status?: ProductStatus; hiddenCategories?: ReadonlySet<number> },
) {
  return products.filter(product =>
    (categoryId === null || product.category_id === categoryId) &&
    productHasStatus(product, status, hiddenCategories) &&
    matchesSearch(search, product.name, product.description, product.category),
  );
}
