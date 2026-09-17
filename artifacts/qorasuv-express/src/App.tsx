import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, Router as WouterRouter, useLocation, useParams } from 'wouter';
import {
  ArrowLeft, ArrowRight, BadgeCheck, Banknote, BarChart3, Bike, Boxes, Check, ChevronDown,
  ChevronRight, Clock3, CreditCard, Gift, Headphones, Heart, Home as HomeIcon, Info, LayoutDashboard,
  ListFilter, LoaderCircle, MapPin, Menu, Minus, Package, Phone, Plus, RefreshCw, Search,
  Settings, ShoppingBag, ShoppingBasket, SlidersHorizontal, Sparkles, Store, Tag, Trophy, Truck,
  UserRound, WalletCards, X, Zap,
} from 'lucide-react';
import {
  getGetAdminDashboardQueryKey, getGetAdminSessionQueryKey, getGetOrderQueryKey, getListAdminOrdersQueryKey,
  getListOrdersQueryKey, getListProductsQueryKey, getGetProductQueryKey,
  getListCategoriesQueryKey, getHealthCheckQueryKey, getGetDeliveryFeeEstimateQueryKey,
  getGetWeeklyLeaderboardQueryKey, useAdminLogout, useCreateAdminCategory, useCreateAdminProduct, useCreateOrder,
  useGetAdminDashboard, useGetAdminSession, useGetDeliveryFeeEstimate,
  useGetOrder, useGetProduct, useGetWeeklyLeaderboard, useHealthCheck, useListAdminOrders,
  useListCategories, useListOrders, useListProducts, useUpdateAdminOrderStatus, useUpdateAdminProduct,
  type AdminDashboard, type Category, type Order, type OrderStatus, type Product, type WeeklyLeaderboardEntry,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import NotFound from '@/pages/not-found';
import { CartProvider, useCart, CartLine } from '@/lib/cart';
import { ProductPicker } from '@/components/ProductPicker';
import { AdminGate } from '@/pages/admin/AdminGate';
import { AdminLogin } from '@/pages/admin/AdminLogin';

const queryClient = new QueryClient();
const money = (value: number) => `${Math.round(value).toLocaleString('ru-RU')} so'm`;
const date = (value: string) => new Intl.DateTimeFormat('uz-UZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const unitLabel = (unit: string) => ({ dona: 'dona', kg: 'kg', litr: 'litr', qadoq: 'qadoq' }[unit] || unit);
const customerNameStorageKey = 'qorasuv-customer-name';
const readCustomerName = () => { try { return localStorage.getItem(customerNameStorageKey) || ''; } catch { return ''; } };
const statusLabel: Record<string, string> = { new: 'Yangi', preparing: 'Tayyorlanmoqda', courier: 'Kuryerga berildi', delivered: 'Yetkazildi', cancelled: 'Bekor qilindi' };
const statusTone: Record<string, string> = { new: 'bg-[#fff0d4] text-[#a25e08]', preparing: 'bg-[#e9f3e9] text-[#23735e]', courier: 'bg-[#e1f0ed] text-[#17695e]', delivered: 'bg-[#dfeee2] text-[#287244]', cancelled: 'bg-[#f8e3de] text-[#a64b3f]' };

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { count, subtotal } = useCart();
  const [menuOpen, setMenuOpen] = useState(false);
  const logout = useAdminLogout();
  const qc = useQueryClient();
  const isAdmin = location.startsWith('/admin');
  const signOut = () => logout.mutate(undefined, { onSuccess: () => { qc.removeQueries({ queryKey: getGetAdminDashboardQueryKey() }); qc.removeQueries({ queryKey: getListAdminOrdersQueryKey() }); qc.invalidateQueries({ queryKey: getGetAdminSessionQueryKey() }); } });
  const nav = isAdmin ? [
    { href: '/admin', label: 'Umumiy ko‘rinish', icon: LayoutDashboard },
    { href: '/admin/orders', label: 'Buyurtmalar', icon: Package },
    { href: '/admin/catalog', label: 'Mahsulotlar', icon: Boxes },
  ] : [
    { href: '/', label: 'Bosh sahifa', icon: HomeIcon },
    { href: '/catalog', label: 'Katalog', icon: ShoppingBag },
    { href: '/orders', label: 'Buyurtmalarim', icon: Package },
    { href: '/profile', label: 'Profil', icon: UserRound },
  ];
  return (
    <div className="noise min-h-[100dvh] bg-[hsl(var(--background))]">
      <header className="sticky top-0 z-40 border-b border-[hsl(var(--border))] bg-[hsl(var(--background)/.9)] backdrop-blur-xl">
        <div className="container-wide flex h-[72px] items-center justify-between gap-3">
          <button data-testid="button-open-menu" className="tap flex h-10 w-10 items-center justify-center rounded-full text-[hsl(var(--foreground))] md:hidden" onClick={() => setMenuOpen(true)}><Menu size={20} /></button>
          <Link href={isAdmin ? '/admin' : '/'} data-testid="link-brand" className="group flex items-center gap-2.5">
            <img src="/brand/icon.svg" alt="Q express" className="h-9 w-9 transition-transform group-hover:scale-105" />
            <span className="display text-[20px] font-extrabold tracking-[-.04em] text-[hsl(var(--primary))]">Q <span className="text-[hsl(var(--foreground))]">express</span></span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {nav.map(item => <Link key={item.href} href={item.href} data-testid={`link-nav-${item.label}`} className={`flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold transition hover:bg-[hsl(var(--muted))] ${location === item.href ? 'bg-[hsl(var(--muted))] text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))]'}`}><item.icon size={16} />{item.label}</Link>)}
          </nav>
          <div className="flex items-center gap-2">
            {!isAdmin && <Link href="/cart" data-testid="link-cart" className="tap relative flex h-11 items-center gap-2 rounded-full bg-[hsl(var(--primary))] px-3.5 text-[hsl(var(--primary-foreground))] transition hover:translate-y-[-1px] hover:shadow-[0_8px_18px_rgba(22,116,96,.2)]"><ShoppingBag size={18} /><span className="hidden text-[13px] font-bold sm:inline">{money(subtotal)}</span>{count > 0 && <span data-testid="text-cart-count" className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-[hsl(var(--background))] bg-[hsl(var(--accent))] px-1 text-[10px] font-bold text-white">{count}</span>}</Link>}
            {isAdmin && <Link href="/" data-testid="link-customer-view" className="hidden items-center gap-2 rounded-full border border-[hsl(var(--border))] px-4 py-2 text-[12px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] sm:flex"><Store size={15} /> Mijoz ko‘rinishi</Link>}
            {isAdmin && <button type="button" data-testid="button-admin-logout" onClick={signOut} disabled={logout.isPending} className="hidden rounded-full border border-[hsl(var(--border))] px-4 py-2 text-[12px] font-bold text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-50 sm:block">Chiqish</button>}
            {!isAdmin && <Link href="/profile" data-testid="link-profile-header" className="hidden h-10 w-10 items-center justify-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--primary))] sm:flex"><UserRound size={18} /></Link>}
          </div>
        </div>
      </header>
      {menuOpen && <div className="fixed inset-0 z-50 bg-[hsl(var(--foreground)/.22)] md:hidden" onClick={() => setMenuOpen(false)}>
        <aside className="h-full w-[290px] bg-[hsl(var(--card))] p-5 shadow-2xl" onClick={event => event.stopPropagation()}>
          <div className="mb-10 flex items-center justify-between"><span className="display text-[18px] font-extrabold">Menyu</span><button data-testid="button-close-menu" className="rounded-full p-2 hover:bg-[hsl(var(--muted))]" onClick={() => setMenuOpen(false)}><X size={18} /></button></div>
          <nav className="grid gap-2">{nav.map(item => <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)} data-testid={`link-mobile-${item.label}`} className="flex items-center gap-3 rounded-2xl p-3.5 font-semibold hover:bg-[hsl(var(--muted))]"><item.icon size={19} className="text-[hsl(var(--primary))]" />{item.label}</Link>)}</nav>
          {!isAdmin && <Link href="/admin" onClick={() => setMenuOpen(false)} data-testid="link-mobile-admin" className="mt-8 flex items-center gap-3 rounded-2xl bg-[hsl(var(--muted))] p-3.5 text-sm font-semibold"><LayoutDashboard size={19} /> Store operator</Link>}
          {isAdmin && <button onClick={() => { signOut(); setMenuOpen(false); }} className="mt-8 flex w-full items-center gap-3 rounded-2xl bg-[hsl(var(--muted))] p-3.5 text-sm font-semibold text-[hsl(var(--destructive))]"><LayoutDashboard size={19} /> Chiqish</button>}
        </aside>
      </div>}
      <main className="min-h-[calc(100dvh-72px)]">{children}</main>
      <ProductPicker />
      {!isAdmin && <footer className="mt-20 border-t border-[hsl(var(--border))] bg-[hsl(var(--card)/.55)]"><div className="container-wide flex flex-col gap-3 py-8 text-sm text-[hsl(var(--muted-foreground))] sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2"><img src="/brand/icon.svg" alt="Q express" className="h-6 w-6" /><span className="display text-lg font-extrabold text-[hsl(var(--primary))]">Q <span className="text-[hsl(var(--foreground))]">express</span></span></div><span>Yangi mahsulotlar. Oson buyurtma. Mahallangizda.</span><Link href="/admin" data-testid="link-footer-admin" className="font-semibold text-[hsl(var(--primary))]">Operator kirishi <ArrowRight size={14} className="ml-1 inline" /></Link></div></footer>}
    </div>
  );
}

function LoadingGrid({ rows = 6 }: { rows?: number }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">{Array.from({ length: rows }).map((_, i) => <div key={i} className="overflow-hidden rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card))]"><div className="skeleton aspect-square" /><div className="space-y-3 p-4"><div className="skeleton h-4 w-4/5 rounded" /><div className="skeleton h-3 w-1/2 rounded" /><div className="skeleton h-9 rounded-xl" /></div></div>)}</div>;
}

function QueryError({ retry }: { retry: () => void }) {
  return <div className="rounded-[24px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-6 py-12 text-center"><div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f8e3de] text-[#a64b3f]"><Info size={21} /></div><h3 className="display text-lg font-bold">Ma’lumot yuklanmadi</h3><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Aloqa vaqtincha uzildi. Qayta urinib ko‘ring.</p><button data-testid="button-retry" onClick={retry} className="tap mt-5 inline-flex items-center gap-2 rounded-full bg-[hsl(var(--primary))] px-5 py-2.5 text-sm font-bold text-[hsl(var(--primary-foreground))]"><RefreshCw size={15} /> Qayta urinish</button></div>;
}

function ProductVisual({ product, className = '' }: { product: Product; className?: string }) {
  const [broken, setBroken] = useState(!product.image_url);
  return <div className={`relative overflow-hidden bg-[#eef2df] ${className}`}>
    {!broken ? <img src={product.image_url} alt={product.name} onError={() => setBroken(true)} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" /> : <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_70%_25%,#fff2ca,transparent_34%),linear-gradient(135deg,#d9eadc,#eff0d9)]"><ShoppingBasket size={42} strokeWidth={1.2} className="text-[hsl(var(--primary)/.5)]" /></div>}
    <div className="absolute left-3 top-3 flex gap-1.5">{product.is_new && <span className="rounded-full bg-[hsl(var(--primary))] px-2 py-1 text-[10px] font-bold text-white">Yangi</span>}{product.old_price && <span className="rounded-full bg-[hsl(var(--accent))] px-2 py-1 text-[10px] font-bold text-white">-{Math.round((1 - product.price / product.old_price) * 100)}%</span>}</div>
  </div>;
}

function ProductCard({ product, index = 0 }: { product: Product; index?: number }) {
  const { openPicker, lines } = useCart();
  const line = lines.find(l => l.productId === product.id);
  return <article data-testid={`card-product-${product.id}`} className={`group animate-rise delay-${Math.min(index + 1, 6)} overflow-hidden rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] transition duration-300 hover:-translate-y-1 hover:border-[hsl(var(--primary)/.35)] hover:shadow-[0_16px_32px_rgba(31,63,52,.1)]`}>
    <Link href={`/product/${product.id}`} data-testid={`link-product-${product.id}`} className="block"><ProductVisual product={product} className="aspect-square" /></Link>
    <div className="p-3.5 sm:p-4"><p className="mb-1 text-[11px] font-semibold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">{unitLabel(product.unit)}</p><Link href={`/product/${product.id}`} data-testid={`link-product-name-${product.id}`} className="block min-h-[42px] text-[14px] font-bold leading-snug transition hover:text-[hsl(var(--primary))]">{product.name}</Link><div className="mt-2 flex items-end justify-between gap-2"><div><p className="display text-[17px] font-extrabold">{money(product.price)}</p>{product.old_price && <p className="text-[11px] text-[hsl(var(--muted-foreground))] line-through">{money(product.old_price)}</p>}</div><button data-testid={`button-add-product-${product.id}`} onClick={() => openPicker(product)} disabled={product.stock <= 0} className="tap flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-xl bg-[hsl(var(--secondary))] px-3 text-[hsl(var(--secondary-foreground))] transition hover:bg-[hsl(var(--primary))] hover:text-white disabled:cursor-not-allowed disabled:opacity-50">{line ? <><Check size={15} /></> : <Plus size={18} />}</button></div></div>
  </article>;
}

function CategoryStrip({ categories, onPick }: { categories: Category[]; onPick?: (slug: string) => void }) {
  const iconFor = [ShoppingBasket, Tag, Boxes, Sparkles, Store, WalletCards];
  return <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none]">{categories.map((category, i) => { const Icon = iconFor[i % iconFor.length]; return <button data-testid={`button-category-${category.id}`} key={category.id} onClick={() => onPick?.(category.slug)} className="group flex min-w-[112px] flex-col items-center gap-2 rounded-[20px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-4 transition hover:-translate-y-1 hover:border-[hsl(var(--primary)/.35)] hover:shadow-[var(--shadow-sm)]"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#e8efdc] text-[hsl(var(--primary))] transition group-hover:bg-[hsl(var(--primary))] group-hover:text-white"><Icon size={22} /></span><span className="text-center text-[12px] font-bold leading-tight">{category.name}</span><span className="text-[10px] text-[hsl(var(--muted-foreground))]">{category.product_count} mahsulot</span></button>; })}</div>;
}

function Home() {
  const categories = useListCategories({ query: { queryKey: getListCategoriesQueryKey() } });
  const products = useListProducts({ sort: 'popular' }, { query: { queryKey: getListProductsQueryKey({ sort: 'popular' }) } });
  const [, setLocation] = useLocation();
  return <div className="container-wide py-7 sm:py-10">
    <div className="animate-rise flex flex-col gap-8">
      <section className="relative overflow-hidden rounded-[30px] bg-[hsl(var(--primary))] px-6 py-9 text-[hsl(var(--primary-foreground))] sm:px-10 sm:py-12 lg:px-16"><div className="absolute -right-14 -top-24 h-72 w-72 rounded-full border-[36px] border-[#d8ad4e]/30" /><div className="absolute -bottom-32 right-24 h-64 w-64 rounded-full bg-[#d8ad4e]/15" /><div className="relative max-w-[590px]"><h1 className="display max-w-[620px] text-[clamp(2.3rem,6vw,4.75rem)] font-extrabold leading-[.98]">Q express — vaqtini qadrlaydiganlar uchun</h1><p className="mt-5 max-w-[450px] text-[15px] leading-relaxed text-[#d9e5ce]">Q express bilan oziq-ovqat xaridi sodda: tanlang, buyurtma bering, qolganini biz birpasda yetkazamiz.</p><Link href="/catalog" data-testid="link-hero-catalog" className="tap mt-7 inline-flex items-center gap-2 rounded-full bg-[#f4cc73] px-5 py-3 text-sm font-extrabold text-[#25483e] transition hover:bg-[#ffe19a]">Xaridni boshlash <ArrowRight size={16} /></Link></div><div className="absolute bottom-7 right-10 hidden text-right lg:block"><span className="display block text-7xl font-extrabold leading-none text-[#e4c263]/45">15<span className="text-4xl">min</span></span><span className="text-xs font-bold uppercase tracking-[.15em] text-[#d9dfab]">tezkor yetkazish</span></div></section>
      <section><div className="mb-4 flex items-end justify-between"><div><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Tanlab oling</p><h2 className="display mt-1 text-2xl font-extrabold sm:text-3xl">Nimani izlayapsiz?</h2></div><Link href="/catalog" data-testid="link-see-all-categories" className="hidden items-center gap-1 text-sm font-bold text-[hsl(var(--primary))] sm:flex">Hammasi <ChevronRight size={16} /></Link></div>{categories.isLoading ? <div className="skeleton h-36 rounded-[20px]" /> : categories.isError ? <QueryError retry={() => categories.refetch()} /> : <CategoryStrip categories={(categories.data || []).slice(0, 6)} onPick={slug => setLocation(`/catalog?category=${slug}`)} />}</section>
      <section><div className="mb-4 flex items-end justify-between"><div><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Doim tanlanadi</p><h2 className="display mt-1 text-2xl font-extrabold sm:text-3xl">Mashhur mahsulotlar</h2></div><Link href="/catalog" data-testid="link-see-all-products" className="flex items-center gap-1 text-sm font-bold text-[hsl(var(--primary))]">Barchasi <ArrowRight size={16} /></Link></div>{products.isLoading ? <LoadingGrid rows={4} /> : products.isError ? <QueryError retry={() => products.refetch()} /> : products.data?.length ? <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">{products.data.slice(0, 8).map((product, i) => <ProductCard key={product.id} product={product} index={i} />)}</div> : <EmptyState title="Hozircha mahsulotlar yo‘q" text="Katalog yangilanmoqda, birozdan so‘ng qayta kiring." action="Katalogga o‘tish" href="/catalog" />}</section>
      <section className="grid gap-3 sm:grid-cols-3"><MiniPromise icon={Truck} title="Tez yetkazamiz" text="Qorasuv va atrofida" /><MiniPromise icon={BadgeCheck} title="Yangi mahsulotlar" text="Har kuni tekshiriladi" /><MiniPromise icon={Headphones} title="Yordam kerakmi?" text="Telegram orqali yozing" /></section>
    </div>
  </div>;
}
function MiniPromise({ icon: Icon, title, text }: { icon: typeof Truck; title: string; text: string }) { return <div className="flex items-center gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.7)] p-4"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e8efdc] text-[hsl(var(--primary))]"><Icon size={18} /></span><div><p className="text-sm font-bold">{title}</p><p className="text-xs text-[hsl(var(--muted-foreground))]">{text}</p></div></div>; }

function Catalog() {
  const params = new URLSearchParams(window.location.search);
  const [search, setSearch] = useState(params.get('search') || '');
  const [category, setCategory] = useState(params.get('category') || '');
  const [sort, setSort] = useState<'popular' | 'price_asc' | 'price_desc' | 'newest' | 'discount'>('popular');
  const categories = useListCategories({ query: { queryKey: getListCategoriesQueryKey() } });
  const products = useListProducts({ search: search || undefined, category: category || undefined, sort }, { query: { queryKey: getListProductsQueryKey({ search: search || undefined, category: category || undefined, sort }) } });
  return <div className="container-wide py-7 sm:py-10"><div className="animate-rise"><div className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Q express / Katalog</p><h1 className="display mt-2 text-4xl font-extrabold sm:text-5xl">Barcha mahsulotlar</h1></div><div className="relative w-full sm:w-[300px]"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" size={17} /><input data-testid="input-catalog-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Mahsulot qidirish..." className="h-12 w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] pl-11 pr-4 text-sm outline-none transition focus:border-[hsl(var(--primary))] focus:ring-4 focus:ring-[hsl(var(--primary)/.1)]" /></div></div><div className="mb-8 space-y-4"><div className="flex items-center gap-2 overflow-x-auto pb-1"><button data-testid="button-category-all" onClick={() => setCategory('')} className={`shrink-0 rounded-full px-4 py-2 text-xs font-bold transition ${!category ? 'bg-[hsl(var(--primary))] text-white' : 'border border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:border-[hsl(var(--primary))]'}`}>Barchasi</button>{categories.data?.map(item => <button data-testid={`button-filter-category-${item.id}`} key={item.id} onClick={() => setCategory(item.slug)} className={`shrink-0 rounded-full px-4 py-2 text-xs font-bold transition ${category === item.slug ? 'bg-[hsl(var(--primary))] text-white' : 'border border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:border-[hsl(var(--primary))]'}`}>{item.name}</button>)}</div><div className="flex items-center justify-between gap-3"><p className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]"><SlidersHorizontal size={15} /> {products.data?.length || 0} ta mahsulot</p><label className="flex items-center gap-2 text-sm"><span className="hidden text-[hsl(var(--muted-foreground))] sm:inline">Saralash:</span><select data-testid="select-catalog-sort" value={sort} onChange={event => setSort(event.target.value as typeof sort)} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs font-bold outline-none"><option value="popular">Mashhurligi</option><option value="newest">Yangilari</option><option value="price_asc">Arzonroq</option><option value="price_desc">Qimmatroq</option><option value="discount">Chegirmalar</option></select></label></div></div>{products.isLoading ? <LoadingGrid /> : products.isError ? <QueryError retry={() => products.refetch()} /> : products.data?.length ? <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">{products.data.map((product, i) => <ProductCard key={product.id} product={product} index={i} />)}</div> : <EmptyState title="Mos mahsulot topilmadi" text="Qidiruv so‘zini yoki filtrni o‘zgartirib ko‘ring." action="Filtrlarni tozalash" onClick={() => { setSearch(''); setCategory(''); }} />}</div></div>;
}

function EmptyState({ title, text, action, href, onClick }: { title: string; text: string; action?: string; href?: string; onClick?: () => void }) {
  const content = <><div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[18px] bg-[#e8efdc] text-[hsl(var(--primary))]"><ShoppingBasket size={25} /></div><h3 className="display text-lg font-extrabold">{title}</h3><p className="mx-auto mt-1 max-w-[340px] text-sm text-[hsl(var(--muted-foreground))]">{text}</p>{action && (href ? <Link href={href} data-testid="link-empty-action" className="tap mt-5 inline-flex rounded-full bg-[hsl(var(--primary))] px-5 py-2.5 text-sm font-bold text-white">{action}</Link> : <button data-testid="button-empty-action" onClick={onClick} className="tap mt-5 rounded-full bg-[hsl(var(--primary))] px-5 py-2.5 text-sm font-bold text-white">{action}</button>)}</>;
  return <div className="rounded-[24px] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card)/.55)] px-6 py-16 text-center">{content}</div>;
}

function ProductDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const product = useGetProduct(id, { query: { queryKey: getGetProductQueryKey(id), enabled: Number.isFinite(id) } });
  const { openPicker, lines } = useCart();
  const line = lines.find(l => l.product.id === product.data?.id);
  if (product.isLoading) return <div className="container-wide py-10"><div className="skeleton h-[520px] rounded-[30px]" /></div>;
  if (product.isError || !product.data) return <div className="container-wide py-10"><QueryError retry={() => product.refetch()} /></div>;
  const item = product.data;
  return <div className="container-wide py-7 sm:py-10"><Link href="/catalog" data-testid="link-back-catalog" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-[hsl(var(--muted-foreground))] transition hover:text-[hsl(var(--primary))]"><ArrowLeft size={16} /> Katalogga qaytish</Link><div className="animate-rise grid overflow-hidden rounded-[30px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] lg:grid-cols-[1.04fr_.96fr]"><ProductVisual product={item} className="min-h-[340px] lg:min-h-[590px]" /><div className="flex flex-col justify-center p-6 sm:p-10 lg:p-14"><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">{item.category} / {unitLabel(item.unit)}</p><h1 className="display mt-3 text-4xl font-extrabold leading-tight sm:text-5xl">{item.name}</h1><p className="mt-5 max-w-[500px] leading-relaxed text-[hsl(var(--muted-foreground))]">{item.description || 'Har kuni tanlab olingan, sifatli va yangi mahsulot.'}</p><div className="mt-8 flex items-end gap-3"><span className="display text-3xl font-extrabold">{money(item.price)}</span>{item.old_price && <span className="mb-1 text-sm text-[hsl(var(--muted-foreground))] line-through">{money(item.old_price)}</span>}<span className="mb-1 text-sm text-[hsl(var(--muted-foreground))]">/ {unitLabel(item.unit)}</span></div><div className="mt-8 flex flex-col gap-3 sm:flex-row"><button data-testid="button-add-detail" onClick={() => openPicker(item)} disabled={item.stock <= 0} className="tap flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-[hsl(var(--primary))] px-6 text-sm font-extrabold text-white transition hover:shadow-[0_12px_24px_rgba(22,116,96,.22)] disabled:opacity-50">{line ? <><Check size={18} /> Savatga qo‘shildi</> : <><ShoppingBag size={18} /> Savatga qo‘shish</>}</button><Link href="/cart" data-testid="link-detail-cart" className="flex h-14 items-center justify-center rounded-2xl border border-[hsl(var(--border))] px-6 text-sm font-bold transition hover:bg-[hsl(var(--muted))]">{line ? `Savatda bor` : 'Savatni ko‘rish'}</Link></div><div className="mt-8 grid grid-cols-2 gap-3 border-t border-[hsl(var(--border))] pt-6"><div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><Truck size={16} className="text-[hsl(var(--primary))]" /> Bugun yetkazish</div><div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><BadgeCheck size={16} className="text-[hsl(var(--primary))]" /> {item.stock > 0 ? 'Omborda bor' : 'Tugagan'}</div></div></div></div></div>;
}

function Cart() {
  const { lines, subtotal, remove, openPicker } = useCart();
  return <div className="container-wide py-7 sm:py-10"><div className="mb-8"><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Q express / Savat</p><h1 className="display mt-2 text-4xl font-extrabold sm:text-5xl">Siz tanlaganlar</h1></div>{lines.length === 0 ? <EmptyState title="Savat hali bo‘sh" text="Yaxshi mahsulotlar sizni kutmoqda. Katalogdan biror narsa tanlang." action="Katalogga borish" href="/catalog" /> : <div className="grid gap-5 lg:grid-cols-[1fr_370px]"><section className="space-y-3">{lines.map((line) => {
    const { product, quantity, purchaseMode, amount } = line;
    const lineTotal = purchaseMode === 'amount' ? amount! : quantity * product.price;
    const isContinuous = product.unit === 'kg' || product.unit === 'litr';
    const lineLabel = purchaseMode === 'amount' ? `${money(amount!)} lik (~${quantity} ${product.unit})` : `${isContinuous ? quantity : Math.round(quantity)} ${product.unit}`;
    return <div data-testid={`row-cart-${product.id}`} key={product.id} className="animate-rise flex gap-3 rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 sm:gap-5 sm:p-4"><ProductVisual product={product} className="h-24 w-24 shrink-0 rounded-2xl sm:h-28 sm:w-28" /><div className="flex min-w-0 flex-1 flex-col justify-between py-1"><div className="flex justify-between items-start gap-2"><div><p className="text-[15px] font-bold">{product.name}</p><p className="mt-1 text-xs font-semibold text-[hsl(var(--muted-foreground))]">{lineLabel}</p></div><button data-testid={`button-remove-cart-${product.id}`} onClick={() => remove(product.id)} className="flex h-8 w-8 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] hover:bg-[#f8e3de] hover:text-[#a64b3f] transition"><X size={16} /></button></div><div className="flex items-end justify-between mt-2"><button data-testid={`button-edit-cart-${product.id}`} onClick={() => openPicker(product)} className="text-xs font-bold text-[hsl(var(--primary))] underline underline-offset-2">O'zgartirish</button><p className="display text-base font-extrabold">{money(lineTotal)}</p></div></div></div>;
  })}</section><aside className="h-fit rounded-[24px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-6 lg:sticky lg:top-24"><h2 className="display text-xl font-extrabold">Buyurtma xulosasi</h2><div className="mt-5 space-y-3 border-b border-[hsl(var(--border))] pb-5 text-sm"><div className="flex justify-between"><span className="text-[hsl(var(--muted-foreground))]">Mahsulotlar</span><span className="font-bold">{money(subtotal)}</span></div><div className="flex justify-between"><span className="text-[hsl(var(--muted-foreground))]">Yetkazib berish</span><span className="font-bold">Checkoutda aniqlanadi</span></div></div><div className="mt-5 flex justify-between"><span className="font-bold">Mahsulotlar jami</span><span data-testid="text-cart-total" className="display text-2xl font-extrabold">{money(subtotal)}</span></div><p className="mt-3 rounded-xl bg-[#fff2d4] p-3 text-xs font-semibold text-[#91600f]">Birinchi buyurtma bepul. Keyingi buyurtmalar uchun yetkazish 4 590 so‘m.</p><Link href="/checkout" data-testid="link-checkout" className="tap mt-5 flex h-13 items-center justify-center gap-2 rounded-2xl bg-[hsl(var(--primary))] px-5 py-3.5 text-sm font-extrabold text-white transition hover:shadow-[0_12px_24px_rgba(22,116,96,.2)]">Buyurtmani rasmiylashtirish <ArrowRight size={17} /></Link><div className="mt-4 flex items-center justify-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><Clock3 size={14} /> Taxminan 30–45 daqiqada</div></aside></div>}</div>;
}

function Checkout() {
  const { lines, subtotal, clear } = useCart();
  const createOrder = useCreateOrder();
  const [, setLocation] = useLocation();
  const [customerName, setCustomerName] = useState(readCustomerName);
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [payment, setPayment] = useState<'cash' | 'click' | 'payme' | 'uzcard' | 'humo'>('cash');
  const [serverError, setServerError] = useState('');
  const canEstimate = phone.trim().length >= 7;
  const deliveryEstimate = useGetDeliveryFeeEstimate(
    { phone: phone.trim() },
    { query: { queryKey: getGetDeliveryFeeEstimateQueryKey({ phone: phone.trim() }), enabled: canEstimate } },
  );
  const delivery = deliveryEstimate.data?.delivery_fee;
  
  const submit = () => {
    if (customerName.trim().length < 2 || !address.trim() || phone.trim().length < 7 || !lines.length) return;
    setServerError('');
    createOrder.mutate({ 
      data: { 
        customer_name: customerName.trim(), 
        address, 
        phone, 
        payment_method: payment, 
        items: lines.map(line => ({ 
          product_id: line.product.id, 
          purchase_mode: line.purchaseMode,
          ...(line.purchaseMode === 'amount' ? { amount: line.amount } : { quantity: line.quantity })
        })) 
      } 
    }, { 
      onSuccess: order => { clear(); setLocation(`/orders/${order.id}`); },
      onError: (err: any) => setServerError(err.response?.data?.message || 'Buyurtma yuborishda xatolik yuz berdi')
    });
  };
  
  if (!lines.length) return <div className="container-wide py-10"><EmptyState title="Rasmiylashtirish uchun savatni to‘ldiring" text="Buyurtmaga kamida bitta mahsulot qo‘shing." action="Katalogga borish" href="/catalog" /></div>;
  return <div className="container-wide py-7 sm:py-10"><Link href="/cart" data-testid="link-back-cart" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-[hsl(var(--muted-foreground))]"><ArrowLeft size={16} /> Savatga qaytish</Link><div className="mb-7"><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Qadam 2 / 2</p><h1 className="display mt-2 text-4xl font-extrabold sm:text-5xl">Buyurtmani yakunlash</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Yetkazish ma’lumotlarini kiriting — tez orada eshigingizni taqillatamiz.</p></div><div className="grid gap-5 lg:grid-cols-[1fr_370px]"><section className="space-y-5"><div className="rounded-[24px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7"><SectionTitle number="01" title="Yetkazish manzili" /><label className="mt-5 block text-sm font-bold">Ism-familiya<input data-testid="input-customer-name" value={customerName} onChange={event => { const value = event.target.value; setCustomerName(value); try { localStorage.setItem(customerNameStorageKey, value); } catch {} }} placeholder="Masalan: Bahrom Asrorov" maxLength={80} autoComplete="name" className="mt-2 h-12 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 text-sm outline-none focus:border-[hsl(var(--primary))]" /></label><label className="mt-4 block text-sm font-bold">Manzil<input data-testid="input-address" value={address} onChange={event => setAddress(event.target.value)} placeholder="Masalan: Qorasuv, 12-uy, 7-xonadon" className="mt-2 h-12 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 text-sm outline-none focus:border-[hsl(var(--primary))]" /></label><label className="mt-4 block text-sm font-bold">Telefon raqam<input data-testid="input-phone" value={phone} onChange={event => setPhone(event.target.value)} type="tel" placeholder="+998 90 123 45 67" className="mt-2 h-12 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 text-sm outline-none focus:border-[hsl(var(--primary))]" /></label><p className="mt-3 rounded-xl bg-[#e8efdc] p-3 text-xs font-semibold text-[hsl(var(--primary))]">Birinchi buyurtma bepul, keyingi buyurtmalar uchun yetkazish 4 590 so‘m.</p></div><div className="rounded-[24px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7"><SectionTitle number="02" title="To‘lov usuli" /><div className="mt-5 grid gap-2 sm:grid-cols-2">{[['cash', 'Naqd pul', Banknote], ['click', 'Click', CreditCard], ['payme', 'Payme', WalletCards], ['uzcard', 'Uzcard', CreditCard], ['humo', 'Humo', CreditCard]].map(([value, label, Icon]) => <button data-testid={`button-payment-${value}`} key={value as string} onClick={() => setPayment(value as typeof payment)} className={`flex items-center gap-3 rounded-xl border p-3.5 text-left text-sm font-bold transition ${payment === value ? 'border-[hsl(var(--primary))] bg-[#e8efdc] text-[hsl(var(--primary))]' : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]'}`}><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(var(--card))]"><Icon size={16} /></span>{label as string}{payment === value && <Check size={16} className="ml-auto" />}</button>)}</div></div>{serverError && <div className="rounded-2xl border border-[#e6b2a8] bg-[#fdf0ed] p-4 text-sm font-semibold text-[#9d493e]">{serverError}</div>}</section><aside className="h-fit rounded-[24px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-6 lg:sticky lg:top-24"><SectionTitle number="03" title="Buyurtma" /><div className="mt-5 space-y-3">{lines.map(line => {
    const lineTotal = line.purchaseMode === 'amount' ? line.amount! : line.quantity * line.product.price;
    const lineLabel = line.purchaseMode === 'amount' ? `${money(line.amount!)} lik` : `${line.quantity} ${line.product.unit}`;
    return <div key={line.product.id} className="flex justify-between gap-3 text-sm"><span className="truncate text-[hsl(var(--muted-foreground))]">{line.product.name} ({lineLabel})</span><span className="shrink-0 font-bold">{money(lineTotal)}</span></div>;
  })}</div><div className="mt-5 space-y-3 border-t border-[hsl(var(--border))] pt-5 text-sm"><div className="flex justify-between"><span className="text-[hsl(var(--muted-foreground))]">Yetkazib berish</span><span className="font-bold">{delivery === undefined ? (canEstimate ? 'Hisoblanmoqda...' : 'Telefon kiriting') : delivery === 0 ? 'Bepul' : money(delivery)}</span></div><div className="flex justify-between"><span className="font-bold">Jami</span><span data-testid="text-checkout-total" className="display text-2xl font-extrabold">{delivery === undefined ? '—' : money(subtotal + delivery)}</span></div></div><button data-testid="button-submit-order" onClick={submit} disabled={createOrder.isPending || customerName.trim().length < 2 || !address || phone.length < 7} className="tap mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[hsl(var(--primary))] text-sm font-extrabold text-white transition hover:shadow-[0_12px_24px_rgba(22,116,96,.2)] disabled:cursor-not-allowed disabled:opacity-50">{createOrder.isPending ? <><LoaderCircle size={18} className="animate-spin" /> Yuborilmoqda...</> : <>Buyurtma berish <ArrowRight size={17} /></>}</button></aside></div></div>;
}
function SectionTitle({ number, title }: { number: string; title: string }) { return <div className="flex items-center gap-3"><span className="mono flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(var(--secondary))] text-[11px] font-bold">{number}</span><h2 className="display text-xl font-extrabold">{title}</h2></div>; }

function Orders() {
  const orders = useListOrders({ query: { queryKey: getListOrdersQueryKey() } });
  return <div className="container-wide py-7 sm:py-10"><div className="mb-8 flex items-end justify-between"><div><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Q express / Tarix</p><h1 className="display mt-2 text-4xl font-extrabold sm:text-5xl">Buyurtmalarim</h1></div><Link href="/catalog" data-testid="link-orders-shop" className="hidden items-center gap-2 rounded-full bg-[hsl(var(--secondary))] px-4 py-2.5 text-sm font-bold sm:flex">Yana xarid qilish <ArrowRight size={15} /></Link></div>{orders.isLoading ? <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="skeleton h-28 rounded-[22px]" />)}</div> : orders.isError ? <QueryError retry={() => orders.refetch()} /> : orders.data?.length ? <div className="space-y-3">{orders.data.map((order, i) => <OrderRow key={order.id} order={order} index={i} />)}</div> : <EmptyState title="Hali buyurtma bermagansiz" text="Birinchi xaridingizni qiling — hammasi shu yerda ko‘rinadi." action="Katalogni ko‘rish" href="/catalog" />}</div>;
}
function OrderRow({ order, index = 0 }: { order: Order; index?: number }) { return <Link href={`/orders/${order.id}`} data-testid={`link-order-${order.id}`} className={`animate-rise delay-${Math.min(index + 1, 6)} group flex flex-col gap-4 rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 transition hover:-translate-y-0.5 hover:border-[hsl(var(--primary)/.35)] sm:flex-row sm:items-center sm:justify-between sm:p-5`}><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e8efdc] text-[hsl(var(--primary))]"><Package size={20} /></span><div><p className="text-sm font-extrabold">#{order.order_number}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{date(order.created_at)} · {order.items.length} mahsulot</p></div></div><div className="flex items-center justify-between gap-5 sm:justify-end"><div className="text-left sm:text-right"><span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${statusTone[order.status]}`}>{statusLabel[order.status]}</span><p className="mt-1 display text-base font-extrabold">{money(order.total)}</p></div><ChevronRight size={18} className="text-[hsl(var(--muted-foreground))] transition group-hover:translate-x-1 group-hover:text-[hsl(var(--primary))]" /></div></Link>; }

function OrderDetail() {
  const params = useParams<{ id: string }>(); const id = Number(params.id);
  const order = useGetOrder(id, { query: { queryKey: getGetOrderQueryKey(id), enabled: Number.isFinite(id), refetchInterval: 10000, refetchOnWindowFocus: true } });
  if (order.isLoading) return <div className="container-wide py-10"><div className="skeleton h-[500px] rounded-[28px]" /></div>;
  if (order.isError || !order.data) return <div className="container-wide py-10"><QueryError retry={() => order.refetch()} /></div>;
  const item = order.data; const steps = ['new', 'preparing', 'courier', 'delivered']; const current = steps.indexOf(item.status);
  return <div className="container-wide py-7 sm:py-10"><Link href="/orders" data-testid="link-back-orders" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-[hsl(var(--muted-foreground))]"><ArrowLeft size={16} /> Buyurtmalarim</Link><div className="mb-7 flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Buyurtma tafsiloti</p><h1 className="display mt-2 text-4xl font-extrabold">#{item.order_number}</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">{date(item.created_at)}</p></div><span data-testid="status-order" className={`w-fit rounded-full px-3 py-1.5 text-xs font-bold ${statusTone[item.status]}`}>{statusLabel[item.status]}</span></div><div className="grid gap-5 lg:grid-cols-[1fr_360px]"><section className="space-y-5"><div className="rounded-[24px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7"><h2 className="display text-xl font-extrabold">Yetkazish holati</h2><div className="mt-7">{item.status === 'cancelled' ? <div className="rounded-2xl bg-[#fdf0ed] p-4 text-sm font-semibold text-[#9d493e]">Bu buyurtma bekor qilingan.</div> : <div className="relative grid grid-cols-4">{steps.map((step, i) => <div key={step} className="relative flex flex-col items-center text-center"><div className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-4 border-[hsl(var(--card))] ${i <= current ? 'bg-[hsl(var(--primary))] text-white' : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'}`}>{i <= current ? <Check size={16} /> : <span className="text-xs font-bold">{i + 1}</span>}</div><span className={`mt-2 text-[10px] font-bold sm:text-xs ${i <= current ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))]'}`}>{statusLabel[step]}</span>{i < 3 && <span className={`absolute left-1/2 top-5 h-1 w-full ${i < current ? 'bg-[hsl(var(--primary))]' : 'bg-[hsl(var(--muted))]'}`} />}</div>)}</div>}</div></div><div className="rounded-[24px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7"><h2 className="display text-xl font-extrabold">Mahsulotlar</h2><div className="mt-5 divide-y divide-[hsl(var(--border))]">{item.items.map(line => {
    const isContinuous = line.unit === 'kg' || line.unit === 'litr';
    const lineLabel = line.purchase_mode === 'amount' 
      ? `${money(line.requested_amount!)} lik (~${line.quantity} ${line.unit})` 
      : `${isContinuous ? line.quantity : Math.round(line.quantity)} ${line.unit}`;
    return <div key={line.product_id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"><div><p className="text-sm font-bold">{line.name}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{lineLabel} · {money(line.price)} / {line.unit}</p></div><p className="text-sm font-extrabold">{money(line.total)}</p></div>;
  })}</div></div></section><aside className="h-fit space-y-3 lg:sticky lg:top-24"><div className="rounded-[24px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5"><h2 className="display text-lg font-extrabold">Manzil</h2><p className="mt-3 flex gap-2 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]"><MapPin size={16} className="mt-0.5 shrink-0 text-[hsl(var(--primary))]" />{item.address}</p><p className="mt-3 flex gap-2 text-sm text-[hsl(var(--muted-foreground))]"><Phone size={16} className="shrink-0 text-[hsl(var(--primary))]" />{item.phone}</p></div><div className="rounded-[24px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5"><h2 className="display text-lg font-extrabold">To‘lov</h2><div className="mt-4 space-y-2 text-sm"><div className="flex justify-between"><span className="text-[hsl(var(--muted-foreground))]">Mahsulotlar</span><b>{money(item.subtotal)}</b></div><div className="flex justify-between"><span className="text-[hsl(var(--muted-foreground))]">Yetkazish</span><b>{money(item.delivery_fee)}</b></div><div className="flex justify-between border-t border-[hsl(var(--border))] pt-3"><span className="font-bold">Jami</span><b className="display text-xl">{money(item.total)}</b></div></div></div></aside></div></div>;
}

function Profile() {
  const [saved, setSaved] = useState(false);
  const customerName = readCustomerName();
  const leaderboard = useGetWeeklyLeaderboard({ query: { queryKey: getGetWeeklyLeaderboardQueryKey() } });
  return <div className="container-wide py-7 sm:py-10"><div className="mb-8"><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Q express / Profil</p><h1 className="display mt-2 text-4xl font-extrabold sm:text-5xl">Siz uchun</h1></div><div className="grid gap-5 lg:grid-cols-[.82fr_1.18fr]"><section className="rounded-[26px] bg-[hsl(var(--primary))] p-6 text-white sm:p-8"><div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#f4cc73] text-2xl font-extrabold text-[#25483e]">{(customerName || 'I').charAt(0).toUpperCase()}</div><h2 className="display mt-6 text-3xl font-extrabold">{customerName || 'Ism kiritilmagan'}</h2><p className="mt-2 text-sm text-[#d9e5ce]">Q express bilan xaridingiz yanada oson.</p><Link href="/orders" data-testid="link-profile-orders" className="mt-8 flex items-center justify-between rounded-2xl bg-white/10 p-4 text-sm font-bold transition hover:bg-white/15">Buyurtmalarim <ArrowRight size={17} /></Link></section><section className="space-y-3"><ProfileSetting icon={MapPin} title="Saqlangan manzillar" description="Uy va ish manzilingizni qo‘shing" action="Qo‘shish" onClick={() => setSaved(true)} /><ProfileSetting icon={Settings} title="Bildirishnomalar" description="Buyurtma holati va foydali yangiliklar" toggle /><ProfileSetting icon={Headphones} title="Yordam markazi" description="Savollaringizga javob toping" action="Ko‘rish" /><ProfileSetting icon={Info} title="Q express haqida" description="Yetkazish hududi va shartlar" action="O‘qish" />{saved && <div className="animate-rise rounded-2xl border border-[hsl(var(--primary)/.25)] bg-[#e8efdc] p-4 text-sm font-semibold text-[hsl(var(--primary))]"><Check size={16} className="mr-2 inline" /> Manzil qo‘shish imkoniyati tez orada mavjud bo‘ladi.</div>}<WeeklyLeaderboard entries={leaderboard.data} loading={leaderboard.isLoading} /></section></div></div>;
}
function ProfileSetting({ icon: Icon, title, description, action, toggle, onClick }: { icon: typeof MapPin; title: string; description: string; action?: string; toggle?: boolean; onClick?: () => void }) { return <div className="flex items-center gap-4 rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 sm:p-5"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#e8efdc] text-[hsl(var(--primary))]"><Icon size={19} /></span><div className="min-w-0 flex-1"><p className="text-sm font-extrabold">{title}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{description}</p></div>{toggle ? <button data-testid={`button-toggle-${title}`} className="relative h-6 w-11 rounded-full bg-[hsl(var(--primary))]"><span className="absolute right-1 top-1 h-4 w-4 rounded-full bg-white" /></button> : action && <button data-testid={`button-profile-${title}`} onClick={onClick} className="rounded-full border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-bold transition hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary))]">{action}</button>}</div>; }

function AdminDashboard() {
  const dashboard = useGetAdminDashboard({ query: { queryKey: getGetAdminDashboardQueryKey() } });
  const orders = useListAdminOrders(undefined, { query: { queryKey: getListAdminOrdersQueryKey() } });
  const leaderboard = useGetWeeklyLeaderboard({ query: { queryKey: getGetWeeklyLeaderboardQueryKey() } });
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey() } });
  const update = useUpdateAdminOrderStatus();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | OrderStatus>('all');
  const metrics = dashboard.data;
  const shown = (orders.data || []).filter(order => filter === 'all' || order.status === filter);
  const changeStatus = (id: number, status: OrderStatus) => update.mutate({ id, data: { status } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListAdminOrdersQueryKey() }); qc.invalidateQueries({ queryKey: getGetAdminDashboardQueryKey() }); } });
  return <div className="container-wide py-7 sm:py-10"><div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Operator workspace / Bugun</p><h1 className="display mt-2 text-4xl font-extrabold sm:text-5xl">Salom, do‘kon.</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Bugungi oqimni bir qarashda boshqaring.</p></div><div className="flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs font-bold"><span className={`h-2 w-2 rounded-full ${health.isError ? 'bg-[#c85d50]' : 'bg-[#3c9d70]'}`} /> {health.isError ? 'Server tekshirilmoqda' : 'Tizim ishlayapti'}</div></div>{dashboard.isLoading ? <AdminSkeleton /> : dashboard.isError || !metrics ? <QueryError retry={() => dashboard.refetch()} /> : <><div className="mb-5 rounded-[22px] border border-[hsl(var(--primary)/.18)] bg-[#e8efdc] p-4 text-sm text-[hsl(var(--primary))]"><p className="font-extrabold">Admin panel qoidalari</p><p className="mt-1 leading-relaxed">Buyurtma holatini faqat ketma-ket yangilash mumkin: <b>Tayyorlanmoqda</b>, so‘ng <b>Kuryerga berildi</b>, va yakunida <b>Yetkazildi</b>.</p></div><Metrics metrics={metrics} /><div className="mt-8 grid gap-5 lg:grid-cols-[1fr_310px]"><section className="rounded-[26px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Live queue</p><h2 className="display mt-1 text-2xl font-extrabold">Buyurtmalar oqimi</h2></div><select data-testid="select-admin-filter" value={filter} onChange={event => setFilter(event.target.value as typeof filter)} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-xs font-bold"><option value="all">Barcha holatlar</option><option value="new">Yangi</option><option value="preparing">Tayyorlanmoqda</option><option value="courier">Kuryerga berildi</option><option value="delivered">Yetkazildi</option></select></div>{orders.isLoading ? <div className="mt-5 space-y-3">{[1,2,3].map(i => <div className="skeleton h-20 rounded-2xl" key={i} />)}</div> : orders.isError ? <div className="mt-5"><QueryError retry={() => orders.refetch()} /></div> : shown.length ? <div className="mt-5 space-y-2">{shown.map(order => <AdminOrderRow key={order.id} order={order} onStatus={changeStatus} pending={update.isPending} />)}</div> : <div className="mt-5"><EmptyState title="Bu filtrda buyurtmalar yo‘q" text="Boshqa holatni tanlab ko‘ring." /></div>}</section><aside className="space-y-3"><div className="rounded-[26px] bg-[#f4cc73] p-6 text-[#25483e]"><p className="mono text-[10px] font-bold uppercase tracking-[.16em]">O‘sish</p><p className="display mt-4 text-4xl font-extrabold">{money(metrics.weekly_revenue)}</p><p className="mt-1 text-sm font-semibold">haftalik tushum</p><div className="mt-6 flex h-20 items-end gap-1.5">{[28,43,35,59,48,75,66,88,62,78,94,82].map((height, i) => <span key={i} className={`flex-1 rounded-t-md ${i === 11 ? 'bg-[#1f6657]' : 'bg-[#fff1bf]/80'}`} style={{ height: `${height}%` }} />)}</div></div><div className="rounded-[26px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6"><div className="flex items-center justify-between"><h2 className="display text-lg font-extrabold">Ombor signali</h2><Boxes size={19} className="text-[hsl(var(--accent))]" /></div><p className="mt-5 display text-4xl font-extrabold">{metrics.low_stock_count}</p><p className="text-sm text-[hsl(var(--muted-foreground))]">mahsulotda zaxira kam</p><Link href="/admin/catalog" data-testid="link-admin-inventory" className="mt-5 flex items-center gap-2 text-sm font-bold text-[hsl(var(--primary))]">Inventarni ko‘rish <ArrowRight size={15} /></Link></div></aside></div><div className="mt-5"><WeeklyLeaderboard entries={leaderboard.data} loading={leaderboard.isLoading} /></div></>}</div>;
}

function AdminCatalogManager() {
  const categories = useListCategories({ query: { queryKey: getListCategoriesQueryKey() } });
  const products = useListProducts(undefined, { query: { queryKey: getListProductsQueryKey() } });
  const createCategory = useCreateAdminCategory();
  const createProduct = useCreateAdminProduct();
  const updateProduct = useUpdateAdminProduct();
  const qc = useQueryClient();
  const [categoryName, setCategoryName] = useState('');
  const [categorySlug, setCategorySlug] = useState('');
  const [categoryIcon, setCategoryIcon] = useState('leaf');
  const [product, setProduct] = useState({ category_id: '', name: '', description: '', image_url: '', price: '', old_price: '', unit: 'dona', stock: '0' });
  const [editingPrice, setEditingPrice] = useState<{ id: number; value: string } | null>(null);
  const [feedback, setFeedback] = useState('');
  const slugify = (value: string) => value.toLowerCase().trim().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const invalidateCatalog = () => { qc.invalidateQueries({ queryKey: getListCategoriesQueryKey() }); qc.invalidateQueries({ queryKey: getListProductsQueryKey() }); };
  const submitCategory = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createCategory.mutate({ data: { name: categoryName, slug: categorySlug || slugify(categoryName), icon: categoryIcon } }, {
      onSuccess: () => { setCategoryName(''); setCategorySlug(''); setFeedback('Kategoriya qo‘shildi.'); invalidateCatalog(); },
    });
  };
  const submitProduct = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!product.category_id) return setFeedback('Mahsulot uchun kategoriya tanlang.');
    const isContinuous = product.unit === 'kg' || product.unit === 'litr';
    const parsedStock = parseFloat(product.stock);
    if (!Number.isFinite(parsedStock) || parsedStock < 0 || (!isContinuous && !Number.isInteger(parsedStock))) {
      return setFeedback('Miqdor xato kiritildi.');
    }
    createProduct.mutate({ data: { category_id: Number(product.category_id), name: product.name, description: product.description, image_url: product.image_url, price: Number(product.price), old_price: product.old_price ? Number(product.old_price) : null, unit: product.unit as 'dona' | 'kg' | 'litr' | 'qadoq', stock: Number(parsedStock.toFixed(3)), is_popular: false, is_new: true } }, {
      onSuccess: () => { setProduct({ category_id: product.category_id, name: '', description: '', image_url: '', price: '', old_price: '', unit: 'dona', stock: '0' }); setFeedback('Mahsulot qo‘shildi.'); invalidateCatalog(); },
    });
  };
  const savePrice = (id: number) => {
    if (!editingPrice || !editingPrice.value || Number(editingPrice.value) < 0) return;
    updateProduct.mutate({ id, data: { price: Number(editingPrice.value) } }, { onSuccess: () => { setEditingPrice(null); setFeedback('Mahsulot narxi yangilandi.'); invalidateCatalog(); } });
  };
  return <div className="container-wide py-7 sm:py-10"><section data-testid="admin-catalog-manager" className="rounded-[26px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7"><div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end"><div><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Katalog boshqaruvi</p><h2 className="display mt-1 text-2xl font-extrabold">Kategoriya va mahsulotlar</h2><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Yangi kategoriya qo‘shing, mahsulot yarating yoki narxini yangilang.</p></div>{feedback && <p role="status" className="rounded-full bg-[#e8efdc] px-3 py-1.5 text-xs font-bold text-[hsl(var(--primary))]">{feedback}</p>}</div><div className="mt-6 grid gap-4 lg:grid-cols-2"><form onSubmit={submitCategory} className="rounded-2xl bg-[hsl(var(--muted)/.55)] p-4"><h3 className="text-sm font-extrabold">Kategoriya qo‘shish</h3><div className="mt-4 grid gap-3 sm:grid-cols-2"><input required minLength={2} value={categoryName} onChange={event => { setCategoryName(event.target.value); if (!categorySlug) setCategorySlug(slugify(event.target.value)); }} placeholder="Masalan: Muzlatilgan" className="h-11 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm outline-none focus:border-[hsl(var(--primary))]" /><input required minLength={2} pattern="[a-z0-9-]+" value={categorySlug} onChange={event => setCategorySlug(event.target.value)} placeholder="muzlatilgan" className="h-11 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm outline-none focus:border-[hsl(var(--primary))]" /></div><div className="mt-3 flex gap-3"><input required value={categoryIcon} onChange={event => setCategoryIcon(event.target.value)} placeholder="Icon nomi" className="h-11 min-w-0 flex-1 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm outline-none focus:border-[hsl(var(--primary))]" /><button disabled={createCategory.isPending} className="rounded-xl bg-[hsl(var(--primary))] px-4 text-xs font-extrabold text-white disabled:opacity-50">{createCategory.isPending ? 'Saqlanmoqda…' : 'Qo‘shish'}</button></div></form><form onSubmit={submitProduct} className="rounded-2xl bg-[hsl(var(--muted)/.55)] p-4"><h3 className="text-sm font-extrabold">Mahsulot qo‘shish</h3><div className="mt-4 grid gap-3 sm:grid-cols-2"><select required value={product.category_id} onChange={event => setProduct({ ...product, category_id: event.target.value })} className="h-11 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm"><option value="">Kategoriya tanlang</option>{categories.data?.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select><input required minLength={2} value={product.name} onChange={event => setProduct({ ...product, name: event.target.value })} placeholder="Mahsulot nomi" className="h-11 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm outline-none" /><input required minLength={2} value={product.description} onChange={event => setProduct({ ...product, description: event.target.value })} placeholder="Qisqa tavsif" className="h-11 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm outline-none" /><input required type="url" value={product.image_url} onChange={event => setProduct({ ...product, image_url: event.target.value })} placeholder="Rasm URL manzili" className="h-11 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm outline-none" /><input required min="0" type="number" value={product.price} onChange={event => setProduct({ ...product, price: event.target.value })} placeholder="Narxi (so‘m)" className="h-11 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm outline-none" /><input min="0" type="number" value={product.old_price} onChange={event => setProduct({ ...product, old_price: event.target.value })} placeholder="Eski narx (ixtiyoriy)" className="h-11 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm outline-none" /><select value={product.unit} onChange={event => setProduct({ ...product, unit: event.target.value })} className="h-11 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm"><option value="dona">Dona</option><option value="kg">Kg</option><option value="litr">Litr</option><option value="qadoq">Qadoq</option></select><input required min="0" type="number" step={product.unit === 'kg' || product.unit === 'litr' ? "0.001" : "1"} value={product.stock} onChange={event => setProduct({ ...product, stock: event.target.value })} placeholder="Qoldiq" className="h-11 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm outline-none" /></div><button disabled={createProduct.isPending} className="mt-3 h-11 w-full rounded-xl bg-[hsl(var(--primary))] text-xs font-extrabold text-white disabled:opacity-50">{createProduct.isPending ? 'Saqlanmoqda…' : 'Mahsulotni qo‘shish'}</button></form></div><div className="mt-6"><div className="flex items-center justify-between"><h3 className="text-sm font-extrabold">Mahsulot narxlari</h3><span className="text-xs text-[hsl(var(--muted-foreground))]">{products.data?.length || 0} ta mahsulot</span></div>{products.isLoading ? <div className="mt-3 skeleton h-20 rounded-2xl" /> : <div className="mt-3 grid gap-2 sm:grid-cols-2">{products.data?.map(item => <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-[hsl(var(--border))] p-3"><div className="min-w-0"><p className="truncate text-sm font-bold">{item.name}</p><p className="text-xs text-[hsl(var(--muted-foreground))]">{item.category} · {item.stock} {item.unit}</p></div>{editingPrice?.id === item.id ? <div className="flex shrink-0 items-center gap-1"><input autoFocus type="number" min="0" value={editingPrice.value} onChange={event => setEditingPrice({ id: item.id, value: event.target.value })} className="h-9 w-24 rounded-lg border border-[hsl(var(--primary))] px-2 text-xs" /><button type="button" onClick={() => savePrice(item.id)} className="rounded-lg bg-[hsl(var(--primary))] px-2 py-2 text-[10px] font-bold text-white">Saqlash</button><button type="button" onClick={() => setEditingPrice(null)} className="rounded-lg border px-2 py-2 text-[10px] font-bold">X</button></div> : <button type="button" onClick={() => setEditingPrice({ id: item.id, value: String(item.price) })} className="shrink-0 rounded-lg bg-[#fff0d4] px-3 py-2 text-xs font-extrabold text-[#8b5f12]">{money(item.price)}</button>}</div>)}</div>}</div></section></div>;
}

function WeeklyLeaderboard(props: { entries?: WeeklyLeaderboardEntry[]; loading: boolean }) {
  return <WeeklyLeaderboardContent {...props} />;
}

function WeeklyLeaderboardContent({ entries, loading }: { entries?: WeeklyLeaderboardEntry[]; loading: boolean }) {
  const topEntries = entries?.slice(0, 10);
  return <section data-testid="weekly-leaderboard" className="rounded-[26px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Haftalik reyting</p><h2 className="display mt-1 text-xl font-extrabold">Top 10 mijozlar</h2><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Eng ko‘p buyurtma bergan TOP 1 mijozga sovg‘a bor.</p><p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">Ism checkout’da kiritiladi; eski buyurtmalarda ism bo‘lmasa “Ism kiritilmagan” ko‘rsatiladi.</p></div><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#fff0d4] text-[#a25e08]"><Trophy size={21} /></span></div>{loading ? <div className="mt-5 space-y-2"><div className="skeleton h-12 rounded-xl" /><div className="skeleton h-12 rounded-xl" /><div className="skeleton h-12 rounded-xl" /></div> : topEntries?.length ? <div className="mt-5 space-y-2">{topEntries.map(entry => <div key={`${entry.rank}-${entry.phone_masked}`} className={`flex items-center gap-3 rounded-2xl p-3 ${entry.is_winner ? 'bg-[#fff6dc]' : 'bg-[hsl(var(--muted)/.6)]'}`}><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-extrabold ${entry.is_winner ? 'bg-[#f4cc73] text-[#25483e]' : 'bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))]'}`}>{entry.rank}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-extrabold">{entry.customer_name}</p><p className="text-[11px] text-[hsl(var(--muted-foreground))]">{entry.phone_masked}{entry.is_winner && <span className="ml-2 font-bold text-[#a25e08]">· {entry.prize}</span>}</p></div><span className="shrink-0 text-right"><b className="display text-lg">{entry.order_count}</b><small className="ml-1 text-[10px] text-[hsl(var(--muted-foreground))]">buyurtma</small></span></div>)}</div> : <div className="mt-5 rounded-2xl bg-[hsl(var(--muted)/.6)] p-4 text-sm text-[hsl(var(--muted-foreground))]">Bu hafta hali reyting uchun buyurtmalar yo‘q.</div>}</section>;
}
function Metrics({ metrics }: { metrics: AdminDashboard }) { const values = [{ label: 'Bugungi buyurtma', value: metrics.today_orders, icon: ShoppingBag, tone: 'bg-[#e8efdc]' }, { label: 'Yangi navbat', value: metrics.new_orders, icon: Zap, tone: 'bg-[#fff0d4]' }, { label: 'Bugungi tushum', value: money(metrics.today_revenue), icon: BarChart3, tone: 'bg-[#dceee9]' }, { label: 'Mijozlar', value: metrics.customer_count, icon: UserRound, tone: 'bg-[#f7e4dc]' }]; return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{values.map((metric, i) => <div key={metric.label} className={`animate-rise delay-${i + 1} rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 sm:p-5`}><div className="flex items-start justify-between gap-2"><span className={`flex h-9 w-9 items-center justify-center rounded-xl ${metric.tone} text-[hsl(var(--primary))]`}><metric.icon size={17} /></span><span className="mono text-[9px] text-[hsl(var(--muted-foreground))]">LIVE</span></div><p data-testid={`text-metric-${i}`} className="display mt-5 text-2xl font-extrabold sm:text-3xl">{metric.value}</p><p className="mt-1 text-xs font-semibold text-[hsl(var(--muted-foreground))]">{metric.label}</p></div>)}</div>; }
function AdminOrderRow({ order, onStatus, pending }: { order: Order; onStatus: (id: number, status: OrderStatus) => void; pending: boolean }) { const next: Partial<Record<OrderStatus, OrderStatus>> = { new: 'preparing', preparing: 'courier', courier: 'delivered' }; return <div data-testid={`row-admin-order-${order.id}`} className="flex flex-col gap-3 rounded-2xl border border-[hsl(var(--border))] p-3.5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[hsl(var(--muted))] text-[hsl(var(--primary))]"><Package size={17} /></span><div><p className="text-sm font-extrabold">#{order.order_number} <span className="font-normal text-[hsl(var(--muted-foreground))]">· {order.customer_name}</span></p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{order.items.length} mahsulot · {money(order.total)}</p></div></div><div className="flex items-center justify-between gap-3 sm:justify-end"><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${statusTone[order.status]}`}>{statusLabel[order.status]}</span>{next[order.status] && <button aria-label={`${order.order_number} statusini ${statusLabel[next[order.status] as string]} qilish`} data-testid={`button-advance-order-${order.id}`} disabled={pending} onClick={() => onStatus(order.id, next[order.status] as OrderStatus)} className="tap flex items-center gap-1 rounded-full bg-[hsl(var(--primary))] px-3 py-1.5 text-[10px] font-bold text-white disabled:opacity-50">{pending ? <LoaderCircle size={12} className="animate-spin" /> : <ChevronRight size={13} />} {statusLabel[next[order.status] as string]}</button>}</div></div>; }
function AdminSkeleton() { return <><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[1,2,3,4].map(i => <div key={i} className="skeleton h-32 rounded-[22px]" />)}</div><div className="mt-8 skeleton h-[430px] rounded-[26px]" /></>; }

function AdminOrders() {
  const orders = useListAdminOrders(undefined, { query: { queryKey: getListAdminOrdersQueryKey() } });
  const update = useUpdateAdminOrderStatus();
  const qc = useQueryClient();
  const changeStatus = (id: number, status: OrderStatus) => update.mutate({ id, data: { status } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListAdminOrdersQueryKey() }); } });
  return <div className="container-wide py-7 sm:py-10"><div className="mb-8"><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Operator workspace</p><h1 className="display mt-2 text-4xl font-extrabold sm:text-5xl">Barcha buyurtmalar</h1></div>{orders.isLoading ? <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="skeleton h-20 rounded-2xl" />)}</div> : orders.isError ? <QueryError retry={() => orders.refetch()} /> : orders.data?.length ? <div className="space-y-3">{orders.data.map(order => <AdminOrderRow key={order.id} order={order} onStatus={changeStatus} pending={update.isPending} />)}</div> : <EmptyState title="Buyurtmalar yo‘q" text="Hozircha tizimda buyurtmalar mavjud emas." />}</div>;
}

function Router() {
  const [location] = useLocation();
  const isAdmin = location.startsWith('/admin');

  if (isAdmin) {
    return (
      <ErrorBoundary resetKey={location}>
        <AdminGate>
          <Switch>
            <Route path="/admin" component={AdminDashboard} />
            <Route path="/admin/orders" component={AdminOrders} />
            <Route path="/admin/catalog" component={AdminCatalogManager} />
            <Route component={NotFound} />
          </Switch>
        </AdminGate>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary resetKey={location}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/catalog" component={Catalog} />
        <Route path="/product/:id" component={ProductDetail} />
        <Route path="/cart" component={Cart} />
        <Route path="/checkout" component={Checkout} />
        <Route path="/orders" component={Orders} />
        <Route path="/orders/:id" component={OrderDetail} />
        <Route path="/profile" component={Profile} />
        <Route component={NotFound} />
      </Switch>
    </ErrorBoundary>
  );
}

export default function App() {
  return <QueryClientProvider client={queryClient}><CartProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Shell><Router /></Shell></WouterRouter></CartProvider></QueryClientProvider>;
}
