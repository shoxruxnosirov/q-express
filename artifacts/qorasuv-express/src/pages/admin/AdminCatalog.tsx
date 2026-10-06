import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Search, Sparkles, Star, X } from 'lucide-react';
import {
  getGetAdminDashboardQueryKey, getListAdminCategoriesQueryKey, getListAdminProductsQueryKey,
  getListCategoriesQueryKey, getListProductsQueryKey, useCreateAdminCategory, useCreateAdminProduct,
  useListAdminCategories, useListAdminProducts,
} from '@workspace/api-client-react';
import { AdminImageField, AdminProductRow, FlagToggle, uploadProductImage } from '@/components/AdminProductRow';
import { AdminCategoryRow, CategoryIconPicker, SLUG_PATTERN, slugify } from '@/components/AdminCategoryRow';
import { apiErrorMessage } from '@/pages/admin/AdminLogin';
import { filterAdminProducts, matchesSearch, productHasStatus, PRODUCT_STATUSES, type ProductStatus } from '@/lib/admin-search';

const inputClass =
  'h-11 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm outline-none focus:border-[hsl(var(--primary))]';

const STATUS_LABELS: Record<ProductStatus, string> = {
  all: 'Hammasi',
  visible: 'Saytda',
  hidden: 'Yashirin',
  'sold-out': 'Tugagan',
  low: 'Kam qolgan',
};

// The dashboard's "Inventarni ko‘rish" opens this page on ?holat=kam.
function statusFromUrl(): ProductStatus {
  const value = new URLSearchParams(window.location.search).get('holat');
  return value === 'kam' ? 'low' : 'all';
}

function SearchField({ value, onChange, placeholder, testId }: { value: string; onChange: (value: string) => void; placeholder: string; testId: string }) {
  return (
    <label className="relative block">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
      {/* type="text": a search input draws its own clear button next to ours. */}
      <input
        type="text"
        enterKeyHint="search"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        data-testid={testId}
        className={`${inputClass} pl-9 pr-9`}
      />
      {value && (
        <button
          type="button"
          aria-label="Qidiruvni tozalash"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
        >
          <X size={14} />
        </button>
      )}
    </label>
  );
}

const emptyProduct = { category_id: '', name: '', description: '', price: '', old_price: '', unit: 'dona', stock: '0' };

export function AdminCatalogManager() {
  const categories = useListAdminCategories({ query: { queryKey: getListAdminCategoriesQueryKey() } });
  const products = useListAdminProducts({ query: { queryKey: getListAdminProductsQueryKey() } });
  const createCategory = useCreateAdminCategory();
  const createProduct = useCreateAdminProduct();
  const qc = useQueryClient();

  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [categorySlug, setCategorySlug] = useState('');
  // The slug follows the name until the admin edits it by hand.
  const [slugEdited, setSlugEdited] = useState(false);
  const [categoryIcon, setCategoryIcon] = useState('leaf');
  const [product, setProduct] = useState(emptyProduct);
  const [productImage, setProductImage] = useState<File | null>(null);
  const [productFlags, setProductFlags] = useState({ is_popular: false, is_new: true });
  const [uploading, setUploading] = useState(false);

  const [categorySearch, setCategorySearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null);
  const [status, setStatus] = useState<ProductStatus>(statusFromUrl);
  const productsRef = useRef<HTMLElement>(null);

  // A notice stays a few seconds; it is pinned to the screen because the row
  // that caused it may be far down the list.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), notice.error ? 8000 : 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const invalidateCatalog = () => {
    qc.invalidateQueries({ queryKey: getListAdminCategoriesQueryKey() });
    qc.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
    qc.invalidateQueries({ queryKey: getListProductsQueryKey() });
    qc.invalidateQueries({ queryKey: getListAdminProductsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetAdminDashboardQueryKey() });
  };
  const done = (text: string) => { setNotice({ text, error: false }); invalidateCatalog(); };
  const fail = (text: string) => setNotice({ text, error: true });

  const allCategories = categories.data ?? [];
  const allProducts = products.data ?? [];
  const visibleCategories = useMemo(() => allCategories.filter(category => category.active), [allCategories]);
  const hiddenCategoryIds = useMemo(() => new Set(allCategories.filter(category => !category.active).map(category => category.id)), [allCategories]);
  // Pickers mark hidden categories, so a product is not put into one unawares.
  const categoryOptions = useMemo(
    () => allCategories.map(category => ({ id: category.id, name: category.active ? category.name : `${category.name} (yashirin)` })),
    [allCategories],
  );
  const shownCategories = useMemo(
    () => allCategories.filter(category => matchesSearch(categorySearch, category.name, category.slug)),
    [allCategories, categorySearch],
  );
  // Counts on the status chips follow the search and the category, so each
  // chip says how many rows clicking it would leave.
  const searched = useMemo(
    () => filterAdminProducts(allProducts, { search: productSearch, categoryId: categoryFilter }),
    [allProducts, productSearch, categoryFilter],
  );
  const shownProducts = useMemo(() => searched.filter(item => productHasStatus(item, status, hiddenCategoryIds)), [searched, status, hiddenCategoryIds]);
  const filtering = productSearch.trim() !== '' || categoryFilter !== null || status !== 'all';
  // A filter on a category that was just deleted would show nothing forever.
  useEffect(() => {
    if (categoryFilter !== null && categories.data && !categories.data.some(category => category.id === categoryFilter)) setCategoryFilter(null);
  }, [categories.data, categoryFilter]);
  // Nor may the new-product form keep pointing at it: the select would show
  // "Kategoriya tanlang" while the save sent the old id.
  useEffect(() => {
    if (product.category_id && categories.data && !categories.data.some(category => String(category.id) === product.category_id)) {
      setProduct(current => ({ ...current, category_id: '' }));
    }
  }, [categories.data, product.category_id]);

  const clearFilters = () => { setProductSearch(''); setCategoryFilter(null); setStatus('all'); };
  const showCategoryProducts = (categoryId: number) => {
    setProductSearch('');
    setStatus('all');
    setCategoryFilter(categoryId);
    productsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const submitCategory = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = categoryName.trim();
    const slug = (categorySlug.trim() || slugify(name)).toLowerCase();
    if (name.length < 2) return fail('Kategoriya nomi kamida 2 harf bo‘lsin.');
    if (slug.length < 2 || !SLUG_PATTERN.test(slug)) return fail('Slug faqat kichik lotin harf, raqam va "-" dan iborat bo‘lsin.');
    createCategory.mutate({ data: { name, slug, icon: categoryIcon } }, {
      onSuccess: () => {
        setCategoryName('');
        setCategorySlug('');
        setSlugEdited(false);
        done(`"${name}" kategoriyasi qo‘shildi.`);
      },
      onError: error => fail(apiErrorMessage(error, 'Kategoriyani qo‘shib bo‘lmadi.')),
    });
  };

  const submitProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!product.category_id) return fail('Mahsulot uchun kategoriya tanlang.');
    if (!productImage) return fail('Mahsulot uchun rasm tanlang.');
    const isContinuous = product.unit === 'kg' || product.unit === 'litr';
    const parsedStock = parseFloat(product.stock);
    if (!Number.isFinite(parsedStock) || parsedStock < 0 || (!isContinuous && !Number.isInteger(parsedStock))) {
      return fail('Miqdor xato kiritildi.');
    }
    // Upload first: a product row is never created pointing at an image that
    // failed to arrive.
    setUploading(true);
    let uploaded;
    try {
      uploaded = await uploadProductImage(productImage);
    } catch (error) {
      setUploading(false);
      return fail(error instanceof Error ? error.message : 'Rasm yuklanmadi.');
    }
    setUploading(false);
    const name = product.name.trim();
    createProduct.mutate({
      data: {
        category_id: Number(product.category_id),
        name,
        description: product.description,
        image_url: uploaded.url,
        image_public_id: uploaded.publicId,
        price: Number(product.price),
        old_price: product.old_price ? Number(product.old_price) : null,
        unit: product.unit as 'dona' | 'kg' | 'litr' | 'qadoq',
        stock: Number(parsedStock.toFixed(3)),
        is_popular: productFlags.is_popular,
        is_new: productFlags.is_new,
      },
    }, {
      onSuccess: () => {
        setProduct({ ...emptyProduct, category_id: product.category_id });
        setProductImage(null);
        setProductFlags({ is_popular: false, is_new: true });
        done(`"${name}" qo‘shildi.`);
      },
      onError: error => fail(apiErrorMessage(error, 'Mahsulotni saqlab bo‘lmadi.')),
    });
  };

  return (
    <div className="container-wide py-7 sm:py-10">
      <section data-testid="admin-catalog-manager" className="rounded-[26px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7">
        <div>
          <p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Katalog boshqaruvi</p>
          <h2 className="display mt-1 text-2xl font-extrabold">Kategoriya va mahsulotlar</h2>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Kategoriya va mahsulotlarni qo‘shing, qidiring, tahrirlang, yashiring yoki o‘chiring.</p>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <section data-testid="admin-categories" className="rounded-2xl bg-[hsl(var(--muted)/.55)] p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold">Kategoriyalar</h3>
              <span className="text-xs text-[hsl(var(--muted-foreground))]">
                {categorySearch ? `${shownCategories.length} / ${allCategories.length}` : allCategories.length} ta
              </span>
            </div>
            <form onSubmit={submitCategory} className="mt-3 grid gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background)/.6)] p-3">
              <p className="text-xs font-extrabold">Yangi kategoriya</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  required
                  minLength={2}
                  value={categoryName}
                  onChange={event => {
                    setCategoryName(event.target.value);
                    if (!slugEdited) setCategorySlug(slugify(event.target.value));
                  }}
                  placeholder="Masalan: Muzlatilgan"
                  aria-label="Kategoriya nomi"
                  data-testid="input-category-name"
                  className={inputClass}
                />
                <input
                  required
                  minLength={2}
                  pattern="[a-z0-9-]+"
                  value={categorySlug}
                  onChange={event => { setCategorySlug(event.target.value); setSlugEdited(event.target.value !== ''); }}
                  placeholder="muzlatilgan"
                  aria-label="Slug"
                  title="Kichik lotin harflar, raqamlar va -"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className={inputClass}
                />
              </div>
              <CategoryIconPicker value={categoryIcon} onPick={setCategoryIcon} disabled={createCategory.isPending} />
              <button
                disabled={createCategory.isPending}
                data-testid="button-create-category"
                className="h-11 rounded-xl bg-[hsl(var(--primary))] px-4 text-xs font-extrabold text-white disabled:opacity-50"
              >
                {createCategory.isPending ? 'Saqlanmoqda…' : 'Kategoriya qo‘shish'}
              </button>
            </form>
            <div className="mt-3">
              <SearchField value={categorySearch} onChange={setCategorySearch} placeholder="Kategoriya qidirish" testId="input-search-categories" />
            </div>
            {categories.isLoading ? (
              <div className="mt-3 skeleton h-16 rounded-xl" />
            ) : categories.isError ? (
              <p className="mt-3 text-xs font-bold text-[#8c1d18]">Kategoriyalar yuklanmadi. <button type="button" className="underline" onClick={() => categories.refetch()}>Qayta urinish</button></p>
            ) : shownCategories.length === 0 ? (
              <p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">{categorySearch ? 'Bunday kategoriya topilmadi.' : 'Hali kategoriya yo‘q.'}</p>
            ) : (
              <div className="mt-3 grid max-h-[460px] gap-2 overflow-y-auto pr-1">
                {shownCategories.map(category => (
                  <AdminCategoryRow
                    key={category.id}
                    category={category}
                    // The place the storefront strip gives it, which picks the
                    // fallback icon; a hidden one is not in that strip at all.
                    index={Math.max(0, visibleCategories.indexOf(category))}
                    onShowProducts={showCategoryProducts}
                    onDone={done}
                    onError={fail}
                  />
                ))}
              </div>
            )}
          </section>

          <form onSubmit={submitProduct} className="rounded-2xl bg-[hsl(var(--muted)/.55)] p-4">
            <h3 className="text-sm font-extrabold">Mahsulot qo‘shish</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <select required value={product.category_id} onChange={event => setProduct({ ...product, category_id: event.target.value })} aria-label="Kategoriya" className={inputClass}>
                <option value="">Kategoriya tanlang</option>
                {categoryOptions.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
              <input required minLength={2} value={product.name} onChange={event => setProduct({ ...product, name: event.target.value })} placeholder="Mahsulot nomi" className={inputClass} />
              <input required minLength={2} value={product.description} onChange={event => setProduct({ ...product, description: event.target.value })} placeholder="Qisqa tavsif" className={inputClass} />
              <div className="sm:col-span-2">
                <AdminImageField file={productImage} onPick={setProductImage} disabled={uploading || createProduct.isPending} />
              </div>
              <input required min="0" type="number" value={product.price} onChange={event => setProduct({ ...product, price: event.target.value })} placeholder="Narxi (so‘m)" className={inputClass} />
              <input min="0" type="number" value={product.old_price} onChange={event => setProduct({ ...product, old_price: event.target.value })} placeholder="Eski narx (ixtiyoriy)" className={inputClass} />
              <select value={product.unit} onChange={event => setProduct({ ...product, unit: event.target.value })} aria-label="Birlik" className={inputClass}>
                <option value="dona">Dona</option>
                <option value="kg">Kg</option>
                <option value="litr">Litr</option>
                <option value="qadoq">Qadoq</option>
              </select>
              <input
                required
                min="0"
                type="number"
                step={product.unit === 'kg' || product.unit === 'litr' ? '0.001' : '1'}
                value={product.stock}
                onChange={event => setProduct({ ...product, stock: event.target.value })}
                placeholder="Qoldiq"
                className={inputClass}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <FlagToggle on={productFlags.is_popular} label="Mashhur" icon={Star} onToggle={() => setProductFlags({ ...productFlags, is_popular: !productFlags.is_popular })} testId="toggle-create-popular" />
              <FlagToggle on={productFlags.is_new} label="Yangi" icon={Sparkles} onToggle={() => setProductFlags({ ...productFlags, is_new: !productFlags.is_new })} testId="toggle-create-new" />
            </div>
            <button disabled={uploading || createProduct.isPending} className="mt-3 h-11 w-full rounded-xl bg-[hsl(var(--primary))] text-xs font-extrabold text-white disabled:opacity-50">
              {uploading ? 'Rasm yuklanmoqda…' : createProduct.isPending ? 'Saqlanmoqda…' : 'Mahsulotni qo‘shish'}
            </button>
          </form>
        </div>

        <section ref={productsRef} data-testid="admin-products" className="mt-6 scroll-mt-24">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-extrabold">Mahsulotlar</h3>
            <span data-testid="text-product-count" className="text-xs text-[hsl(var(--muted-foreground))]">
              {filtering ? `${shownProducts.length} / ${allProducts.length}` : allProducts.length} ta mahsulot
            </span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_220px]">
            <SearchField value={productSearch} onChange={setProductSearch} placeholder="Mahsulot qidirish: nomi, tavsifi, kategoriyasi" testId="input-search-products" />
            <select
              value={categoryFilter ?? ''}
              onChange={event => setCategoryFilter(event.target.value ? Number(event.target.value) : null)}
              aria-label="Kategoriya bo‘yicha"
              data-testid="select-product-category"
              className={inputClass}
            >
              <option value="">Barcha kategoriyalar</option>
              {allCategories.map(category => (
                <option key={category.id} value={category.id}>
                  {category.name}{category.active ? '' : ' (yashirin)'} · {category.product_count}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {PRODUCT_STATUSES.map(value => (
              <button
                key={value}
                type="button"
                aria-pressed={status === value}
                data-testid={`filter-status-${value}`}
                onClick={() => setStatus(value)}
                className={`tap rounded-full border px-3 py-1.5 text-[11px] font-bold transition ${
                  status === value
                    ? 'border-transparent bg-[hsl(var(--primary))] text-white'
                    : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--primary))]'
                }`}
              >
                {STATUS_LABELS[value]} · {searched.filter(item => productHasStatus(item, value, hiddenCategoryIds)).length}
              </button>
            ))}
            {filtering && (
              <button type="button" onClick={clearFilters} className="ml-1 text-[11px] font-bold text-[hsl(var(--primary))] hover:underline">
                Filtrlarni tozalash
              </button>
            )}
          </div>
          {products.isLoading ? (
            <div className="mt-3 skeleton h-20 rounded-2xl" />
          ) : products.isError ? (
            <p className="mt-3 text-xs font-bold text-[#8c1d18]">Mahsulotlar yuklanmadi. <button type="button" className="underline" onClick={() => products.refetch()}>Qayta urinish</button></p>
          ) : shownProducts.length === 0 ? (
            <div className="mt-3 rounded-xl border border-dashed border-[hsl(var(--border))] p-6 text-center">
              <p className="text-sm font-bold">{filtering ? 'Hech narsa topilmadi' : 'Hali mahsulot yo‘q'}</p>
              {filtering && (
                <button type="button" onClick={clearFilters} className="mt-2 text-xs font-bold text-[hsl(var(--primary))] hover:underline">
                  Filtrlarni tozalash
                </button>
              )}
            </div>
          ) : (
            <div className="mt-3 grid gap-2">
              {shownProducts.map(item => (
                <AdminProductRow
                  key={item.id}
                  product={item}
                  categories={categoryOptions}
                  categoryHidden={hiddenCategoryIds.has(item.category_id)}
                  onDone={done}
                  onError={fail}
                />
              ))}
            </div>
          )}
        </section>
      </section>

      {notice && (
        <div
          role={notice.error ? 'alert' : 'status'}
          data-testid="catalog-notice"
          className={`fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-start gap-3 rounded-2xl px-4 py-3 text-sm font-bold shadow-[0_12px_32px_rgba(0,0,0,.18)] ${
            notice.error ? 'bg-[#fdecea] text-[#8c1d18]' : 'bg-[#e8efdc] text-[hsl(var(--primary))]'
          }`}
        >
          <p className="flex-1">{notice.text}</p>
          <button type="button" aria-label="Yopish" onClick={() => setNotice(null)} className="shrink-0 opacity-70 hover:opacity-100">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
