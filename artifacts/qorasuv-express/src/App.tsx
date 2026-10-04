import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, Router as WouterRouter, useLocation, useParams } from 'wouter';
import {
  ArrowLeft, ArrowRight, BadgeCheck, Banknote, BarChart3, Bike, Boxes, Check, ChevronDown,
  ChevronRight, Clock3, CreditCard, Gift, Headphones, Heart, Home as HomeIcon, Info, LayoutDashboard,
  ListFilter, LoaderCircle, MapPin, Menu, MessageCircle, Minus, Package, Phone, Plus, RefreshCw, Search,
  ShieldCheck, ShoppingBag, ShoppingBasket, SlidersHorizontal, Sparkles, Star, Store, Tag, Trophy, Truck,
  UserRound, WalletCards, X, Zap,
} from 'lucide-react';
import {
  getGetAdminDashboardQueryKey, getGetAdminSessionQueryKey, getGetOrderQueryKey, getListAdminOrdersQueryKey,
  getListAdminProductsQueryKey, getListOrdersQueryKey, getListProductsQueryKey, getGetProductQueryKey,
  getListCategoriesQueryKey, getHealthCheckQueryKey, getGetDeliveryFeeEstimateQueryKey,
  getGetWeeklyLeaderboardQueryKey, useAdminLogout, useCreateAdminCategory, useCreateAdminProduct, useCreateOrder,
  useGetAdminDashboard, useGetAdminSession, useGetDeliveryFeeEstimate,
  getGetChatTranscriptQueryKey, getGetCustomerProfileQueryKey, getGetStoreStatusQueryKey, useGetStoreStatus, useCustomerLogout, useGetCustomerProfile,
  useReplaceCustomerAddresses, useUpdateCustomerProfile, type CustomerProfile as ApiCustomerProfile,
  useGetOrder, useGetProduct, useGetWeeklyLeaderboard, useHealthCheck, useListAdminOrders,
  useListAdminProducts, useListCategories, useListOrders, useListProducts, useUpdateAdminOrderStatus,
  type AdminDashboard, type Category, type Order, type OrderStatus, type Product, type WeeklyLeaderboardEntry,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import NotFound from '@/pages/not-found';
import { CartProvider, useCart, CartLine } from '@/lib/cart';
import { inStockFirst, isSoldOut, lineProblemText, useCartAvailability } from '@/lib/stock';
import { cleanAddresses, clearProfile, emptyProfile, forgetAddress, profileFieldError, readProfile, rememberAddress, writeProfile, type CustomerProfile } from '@/lib/profile';
import { emptyAddress, formatAddress, isCompleteAddress, parseAddress, type AddressParts } from '@/lib/address';
import { AddressPicker, AddressSelects, SavedAddressList, type AddressChoice } from '@/components/AddressFields';
import { OpenInTelegram } from '@/components/OpenInTelegram';
import { OrderFeedback } from '@/components/OrderFeedback';
import { TelegramSignIn, isSessionLost, renewTelegramSession, useTelegramBlocked } from '@/components/TelegramSignIn';
import { isMiniApp } from '@/lib/telegram-mini-app';
import { telegramLabel } from '@/lib/telegram-label';
import { orderLineParts } from '@/lib/order-lines';
import { LANGS, useLanguage, useT, type Lang } from '@/i18n';
import storeMessages from '@/i18n/messages/store';
import { unitLabel as localUnit } from '@/i18n/messages/units';
import { DeliveryTime, type DeliveryChoice } from '@/components/DeliveryTime';
import { StoreClosedBanner } from '@/components/StoreClosedBanner';
import { StoreHoursCard } from '@/pages/admin/StoreHoursCard';
import { deliveryLabel } from '@/lib/tashkent-time';
import { formatUzPhone, normalizeUzPhone } from '@/lib/phone';
import { ProductPicker } from '@/components/ProductPicker';
import { AdminImageField, AdminProductRow, FlagToggle, uploadProductImage } from '@/components/AdminProductRow';
import { CustomerChat } from '@/components/CustomerChat';
import { AdminChat } from '@/pages/admin/AdminChat';
import { AdminGate } from '@/pages/admin/AdminGate';
import { AdminAccounts } from '@/pages/admin/AdminAccounts';
import { AdminCustomers } from '@/pages/admin/AdminCustomers';
import { apiErrorMessage } from '@/pages/admin/AdminLogin';
import { AdminProfile } from '@/pages/admin/AdminProfile';

const queryClient = new QueryClient();
const money = (value: number) => `${Math.round(value).toLocaleString('ru-RU')} so'm`;
const date = (value: string) => new Intl.DateTimeFormat('uz-UZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const unitLabel = (unit: string) => ({ dona: 'dona', kg: 'kg', litr: 'litr', qadoq: 'qadoq' }[unit] || unit);
const statusLabel: Record<string, string> = { new: 'Yangi', preparing: 'Tayyorlanmoqda', courier: 'Kuryerga berildi', delivered: 'Yetkazildi', cancelled: 'Bekor qilindi' };
// The customer's side reads the status in their language; the admin pages keep
// statusLabel above.
const statusKey = { new: 'statusNew', preparing: 'statusPreparing', courier: 'statusCourier', delivered: 'statusDelivered', cancelled: 'statusCancelled' } as const;
const when = (value: string, locale: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const statusTone: Record<string, string> = { new: 'bg-[#fff0d4] text-[#a25e08]', preparing: 'bg-[#e9f3e9] text-[#23735e]', courier: 'bg-[#e1f0ed] text-[#17695e]', delivered: 'bg-[#dfeee2] text-[#287244]', cancelled: 'bg-[#f8e3de] text-[#a64b3f]' };

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { count, subtotal } = useCart();
  const [menuOpen, setMenuOpen] = useState(false);
  const logout = useAdminLogout();
  const qc = useQueryClient();
  const isAdmin = location.startsWith('/admin');
  const { t, money } = useT(storeMessages);
  // Shares the gate's cached session, so it knows the role without another call.
  const adminSession = useGetAdminSession({ query: { queryKey: getGetAdminSessionQueryKey(), enabled: isAdmin, retry: false } });
  const isSuperAdmin = adminSession.data?.admin?.role === 'super_admin';
  // Drops every operator query, not just a few, so the next admin to sign in on
  // this device never glimpses the previous one's data.
  const signOut = () => logout.mutate(undefined, { onSuccess: () => {
    qc.setQueryData(getGetAdminSessionQueryKey(), { authenticated: false });
    qc.removeQueries({ predicate: query => { const key = String(query.queryKey[0]); return key.startsWith('/api/admin/') && key !== '/api/admin/session'; } });
  } });
  const nav = isAdmin ? [
    { href: '/admin', label: 'Umumiy ko‘rinish', icon: LayoutDashboard },
    { href: '/admin/orders', label: 'Buyurtmalar', icon: Package },
    { href: '/admin/catalog', label: 'Mahsulotlar', icon: Boxes },
    { href: '/admin/chat', label: 'Suhbatlar', icon: MessageCircle },
    { href: '/admin/customers', label: 'Mijozlar', icon: UserRound },
    ...(isSuperAdmin ? [{ href: '/admin/admins', label: 'Adminlar', icon: ShieldCheck }] : []),
    { href: '/admin/profile', label: 'Profilim', icon: UserRound },
  ] : [
    { href: '/', label: t('navHome'), icon: HomeIcon },
    { href: '/catalog', label: t('navCatalog'), icon: ShoppingBag },
    { href: '/orders', label: t('navOrders'), icon: Package },
    { href: '/profile', label: t('navProfile'), icon: UserRound },
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
            {!isAdmin && <LanguageSwitcher compact />}
            {!isAdmin && <Link href="/cart" data-testid="link-cart" className="tap relative flex h-11 items-center gap-2 rounded-full bg-[hsl(var(--primary))] px-3.5 text-[hsl(var(--primary-foreground))] transition hover:translate-y-[-1px] hover:shadow-[0_8px_18px_rgba(22,116,96,.2)]"><ShoppingBag size={18} /><span className="hidden text-[13px] font-bold sm:inline">{money(subtotal)}</span>{count > 0 && <span data-testid="text-cart-count" className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-[hsl(var(--background))] bg-[hsl(var(--accent))] px-1 text-[10px] font-bold text-white">{count}</span>}</Link>}
            {isAdmin && <Link href="/" data-testid="link-customer-view" className="hidden items-center gap-2 rounded-full border border-[hsl(var(--border))] px-4 py-2 text-[12px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] sm:flex"><Store size={15} /> Mijoz ko‘rinishi</Link>}
            {isAdmin && <button type="button" data-testid="button-admin-logout" onClick={signOut} disabled={logout.isPending} className="hidden rounded-full border border-[hsl(var(--border))] px-4 py-2 text-[12px] font-bold text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-50 sm:block">Chiqish</button>}
            {!isAdmin && <Link href="/profile" data-testid="link-profile-header" className="hidden h-10 w-10 items-center justify-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--primary))] sm:flex"><UserRound size={18} /></Link>}
          </div>
        </div>
      </header>
      {!isAdmin && <StoreClosedBanner />}
      {menuOpen && <div className="fixed inset-0 z-50 bg-[hsl(var(--foreground)/.22)] md:hidden" onClick={() => setMenuOpen(false)}>
        <aside className="h-full w-[290px] bg-[hsl(var(--card))] p-5 shadow-2xl" onClick={event => event.stopPropagation()}>
          <div className="mb-10 flex items-center justify-between"><span className="display text-[18px] font-extrabold">{isAdmin ? 'Menyu' : t('menu')}</span><button data-testid="button-close-menu" className="rounded-full p-2 hover:bg-[hsl(var(--muted))]" onClick={() => setMenuOpen(false)}><X size={18} /></button></div>
          <nav className="grid gap-2">{nav.map(item => <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)} data-testid={`link-mobile-${item.label}`} className="flex items-center gap-3 rounded-2xl p-3.5 font-semibold hover:bg-[hsl(var(--muted))]"><item.icon size={19} className="text-[hsl(var(--primary))]" />{item.label}</Link>)}</nav>
          
          {isAdmin && <button onClick={() => { signOut(); setMenuOpen(false); }} className="mt-8 flex w-full items-center gap-3 rounded-2xl bg-[hsl(var(--muted))] p-3.5 text-sm font-semibold text-[hsl(var(--destructive))]"><LayoutDashboard size={19} /> Chiqish</button>}
        </aside>
      </div>}
      <main className="min-h-[calc(100dvh-72px)]">{children}</main>
      <ProductPicker />
      {!isAdmin && <footer className="mt-20 border-t border-[hsl(var(--border))] bg-[hsl(var(--card)/.55)]"><div className="container-wide flex flex-col gap-3 py-8 text-sm text-[hsl(var(--muted-foreground))] sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2"><img src="/brand/icon.svg" alt="Q express" className="h-6 w-6" /><span className="display text-lg font-extrabold text-[hsl(var(--primary))]">Q <span className="text-[hsl(var(--foreground))]">express</span></span></div><span>{t('footerTagline')}</span></div></footer>}
      {!isAdmin && <CustomerChat />}
      {!isAdmin && <TelegramSignIn />}
      {!isAdmin && <LanguageSync />}
    </div>
  );
}

// The account remembers the language, so another device of the same Telegram
// account opens in it. A failed save (offline, blocked) changes nothing on
// screen; the choice still holds on this device.
// Keeps this device and the account in step. A choice made here (pending) is
// sent to the account once, in one request; with nothing pending, the device
// takes the account's language, so an old choice on another phone never
// flips it back. A save that fails stays pending and is tried on the next
// visit, never in a loop.
function LanguageSync() {
  const { lang, adoptLang, pending, markSaved } = useLanguage();
  const qc = useQueryClient();
  const profile = useGetCustomerProfile({ query: { queryKey: getGetCustomerProfileQueryKey() } });
  const update = useUpdateCustomerProfile();
  const account = profile.data?.authenticated ? profile.data : undefined;
  useEffect(() => {
    if (!account || account.blocked) return;
    if (pending) {
      if (account.language === lang) return markSaved();
      if (update.isPending) return;
      update.mutate({ data: { language: lang } }, {
        onSuccess: saved => { markSaved(); qc.setQueryData(getGetCustomerProfileQueryKey(), saved); },
      });
    } else if (account.language && account.language !== lang) {
      adoptLang(account.language);
    }
    // The account's language, the device's and whether a choice is pending decide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.language, account?.blocked, Boolean(account), pending, lang]);
  return null;
}

// The customer picks the shop's language: a small select in the header, and a
// card on the profile page. Uzbek comes in Latin and Cyrillic.
function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { lang, setLang } = useLanguage();
  const { t } = useT(storeMessages);
  // LanguageSync sends the choice to the account.
  const select = <select data-testid={compact ? 'select-language-header' : 'select-language'} aria-label={t('language')} value={lang} onChange={event => setLang(event.target.value as Lang)} className={compact ? 'h-10 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2.5 text-xs font-bold text-[hsl(var(--primary))] outline-none' : 'mt-3 h-11 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-sm font-semibold outline-none focus:border-[hsl(var(--primary))]'}>{LANGS.map(item => <option key={item.code} value={item.code}>{compact ? item.short : item.label}</option>)}</select>;
  if (compact) return select;
  return <div data-testid="card-language" className="rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5"><p className="text-sm font-extrabold">🌐 {t('language')}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{t('languageHint')}</p>{select}</div>;
}

function LoadingGrid({ rows = 6 }: { rows?: number }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">{Array.from({ length: rows }).map((_, i) => <div key={i} className="overflow-hidden rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card))]"><div className="skeleton aspect-square" /><div className="space-y-3 p-4"><div className="skeleton h-4 w-4/5 rounded" /><div className="skeleton h-3 w-1/2 rounded" /><div className="skeleton h-9 rounded-xl" /></div></div>)}</div>;
}

function QueryError({ retry }: { retry: () => void }) {
  const { t } = useT(storeMessages);
  return <div className="rounded-[24px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-6 py-12 text-center"><div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f8e3de] text-[#a64b3f]"><Info size={21} /></div><h3 className="display text-lg font-bold">{t('loadFailedTitle')}</h3><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{t('loadFailedText')}</p><button data-testid="button-retry" onClick={retry} className="tap mt-5 inline-flex items-center gap-2 rounded-full bg-[hsl(var(--primary))] px-5 py-2.5 text-sm font-bold text-[hsl(var(--primary-foreground))]"><RefreshCw size={15} /> {t('retry')}</button></div>;
}

function ProductVisual({ product, className = '' }: { product: Product; className?: string }) {
  const [broken, setBroken] = useState(!product.image_url);
  const { t, script } = useT(storeMessages);
  return <div className={`relative overflow-hidden bg-[#eef2df] ${className}`}>
    {!broken ? <img src={product.image_url} alt={script(product.name)} onError={() => setBroken(true)} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" /> : <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_70%_25%,#fff2ca,transparent_34%),linear-gradient(135deg,#d9eadc,#eff0d9)]"><ShoppingBasket size={42} strokeWidth={1.2} className="text-[hsl(var(--primary)/.5)]" /></div>}
    {isSoldOut(product) && <div data-testid={`overlay-sold-out-${product.id}`} className="absolute inset-0 flex items-center justify-center bg-white/55"><span className="rounded-full bg-[#5b5f5a] px-3 py-1.5 text-xs font-extrabold uppercase tracking-wide text-white">{t('soldOut')}</span></div>}<div className="absolute left-3 top-3 flex gap-1.5">{product.is_new && <span className="rounded-full bg-[hsl(var(--primary))] px-2 py-1 text-[10px] font-bold text-white">{t('badgeNew')}</span>}{product.old_price && <span className="rounded-full bg-[hsl(var(--accent))] px-2 py-1 text-[10px] font-bold text-white">-{Math.round((1 - product.price / product.old_price) * 100)}%</span>}</div>
  </div>;
}

function ProductCard({ product, index = 0 }: { product: Product; index?: number }) {
  const { openPicker, lines } = useCart();
  const line = lines.find(l => l.productId === product.id);
  const { t, money, script, lang } = useT(storeMessages);
  return <article data-testid={`card-product-${product.id}`} className={`group animate-rise delay-${Math.min(index + 1, 6)} overflow-hidden rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] transition duration-300 hover:-translate-y-1 hover:border-[hsl(var(--primary)/.35)] hover:shadow-[0_16px_32px_rgba(31,63,52,.1)]`}>
    <Link href={`/product/${product.id}`} data-testid={`link-product-${product.id}`} className="block"><ProductVisual product={product} className="aspect-square" /></Link>
    <div className="p-3.5 sm:p-4"><p className="mb-1 text-[11px] font-semibold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">{localUnit(product.unit, lang)}</p><Link href={`/product/${product.id}`} data-testid={`link-product-name-${product.id}`} className="block min-h-[42px] text-[14px] font-bold leading-snug transition hover:text-[hsl(var(--primary))]">{script(product.name)}</Link><div className="mt-2 flex items-end justify-between gap-2"><div><p className="display text-[17px] font-extrabold">{money(product.price)}</p>{product.old_price && <p className="text-[11px] text-[hsl(var(--muted-foreground))] line-through">{money(product.old_price)}</p>}</div>{isSoldOut(product) ? <span data-testid={`text-sold-out-${product.id}`} className="flex h-10 items-center rounded-xl bg-[hsl(var(--muted))] px-3 text-[11px] font-bold text-[hsl(var(--muted-foreground))]">{t('soldOut')}</span> : <button data-testid={`button-add-product-${product.id}`} onClick={() => openPicker(product)} className="tap flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-xl bg-[hsl(var(--secondary))] px-3 text-[hsl(var(--secondary-foreground))] transition hover:bg-[hsl(var(--primary))] hover:text-white">{line ? <><Check size={15} /></> : <Plus size={18} />}</button>}</div></div>
  </article>;
}

function CategoryStrip({ categories, onPick }: { categories: Category[]; onPick?: (slug: string) => void }) {
  const iconFor = [ShoppingBasket, Tag, Boxes, Sparkles, Store, WalletCards];
  const { t, script } = useT(storeMessages);
  return <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none]">{categories.map((category, i) => { const Icon = iconFor[i % iconFor.length]; return <button data-testid={`button-category-${category.id}`} key={category.id} onClick={() => onPick?.(category.slug)} className="group flex min-w-[112px] flex-col items-center gap-2 rounded-[20px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-4 transition hover:-translate-y-1 hover:border-[hsl(var(--primary)/.35)] hover:shadow-[var(--shadow-sm)]"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#e8efdc] text-[hsl(var(--primary))] transition group-hover:bg-[hsl(var(--primary))] group-hover:text-white"><Icon size={22} /></span><span className="text-center text-[12px] font-bold leading-tight">{script(category.name)}</span><span className="text-[10px] text-[hsl(var(--muted-foreground))]">{t('categoryCount', { n: category.product_count })}</span></button>; })}</div>;
}

function Home() {
  const categories = useListCategories({ query: { queryKey: getListCategoriesQueryKey() } });
  const products = useListProducts({ sort: 'popular' }, { query: { queryKey: getListProductsQueryKey({ sort: 'popular' }) } });
  const [, setLocation] = useLocation();
  const { t } = useT(storeMessages);
  return <div className="container-wide py-7 sm:py-10">
    <div className="animate-rise flex flex-col gap-8">
      <section className="relative overflow-hidden rounded-[30px] bg-[hsl(var(--primary))] px-6 py-9 text-[hsl(var(--primary-foreground))] sm:px-10 sm:py-12 lg:px-16"><div className="absolute -right-14 -top-24 h-72 w-72 rounded-full border-[36px] border-[#d8ad4e]/30" /><div className="absolute -bottom-32 right-24 h-64 w-64 rounded-full bg-[#d8ad4e]/15" /><div className="relative max-w-[590px]"><h1 className="display max-w-[620px] text-[clamp(2.3rem,6vw,4.75rem)] font-extrabold leading-[.98]">{t('heroTitle')}</h1><p className="mt-5 max-w-[450px] text-[15px] leading-relaxed text-[#d9e5ce]">{t('heroText')}</p><div className="mt-7 flex flex-wrap items-end justify-between gap-x-2 gap-y-3 lg:block"><Link href="/catalog" data-testid="link-hero-catalog" className="tap inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-[#f4cc73] px-4 py-3 text-sm font-extrabold text-[#25483e] transition hover:bg-[#ffe19a] max-[380px]:px-3.5 max-[380px]:text-[13px] sm:px-5">{t('heroCta')} <ArrowRight size={16} /></Link><div data-testid="text-hero-speed-mobile" className="ml-auto text-right lg:hidden"><span className="display block whitespace-nowrap text-[28px] font-extrabold leading-none text-[#e4c263] max-[380px]:text-2xl sm:text-4xl">15–19<span className="ml-0.5 text-base sm:text-xl">{t('minutes')}</span></span><span className="mt-1 block text-[10px] font-bold uppercase tracking-[.12em] text-[#d9dfab] sm:text-[11px]">{t('fastDelivery')}</span></div></div></div><div className="absolute bottom-7 right-10 hidden text-right lg:block"><span className="display block text-6xl font-extrabold leading-none text-[#e4c263]/45 xl:text-7xl">15–19<span className="text-3xl xl:text-4xl">{t('minutes')}</span></span><span className="text-xs font-bold uppercase tracking-[.15em] text-[#d9dfab]">{t('fastDelivery')}</span></div></section>
      <section><div className="mb-4 flex items-end justify-between"><div><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">{t('pickEyebrow')}</p><h2 className="display mt-1 text-2xl font-extrabold sm:text-3xl">{t('pickTitle')}</h2></div><Link href="/catalog" data-testid="link-see-all-categories" className="hidden items-center gap-1 text-sm font-bold text-[hsl(var(--primary))] sm:flex">{t('everything')} <ChevronRight size={16} /></Link></div>{categories.isLoading ? <div className="skeleton h-36 rounded-[20px]" /> : categories.isError ? <QueryError retry={() => categories.refetch()} /> : <CategoryStrip categories={(categories.data || []).slice(0, 6)} onPick={slug => setLocation(`/catalog?category=${slug}`)} />}</section>
      <section><div className="mb-4 flex items-end justify-between"><div><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">{t('popularEyebrow')}</p><h2 className="display mt-1 text-2xl font-extrabold sm:text-3xl">{t('popularTitle')}</h2></div><Link href="/catalog" data-testid="link-see-all-products" className="flex items-center gap-1 text-sm font-bold text-[hsl(var(--primary))]">{t('seeAll')} <ArrowRight size={16} /></Link></div>{products.isLoading ? <LoadingGrid rows={4} /> : products.isError ? <QueryError retry={() => products.refetch()} /> : products.data?.length ? <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">{inStockFirst(products.data).slice(0, 8).map((product, i) => <ProductCard key={product.id} product={product} index={i} />)}</div> : <EmptyState title={t('emptyHomeTitle')} text={t('emptyHomeText')} action={t('emptyHomeAction')} href="/catalog" />}</section>
      <section className="grid gap-3 sm:grid-cols-3"><MiniPromise icon={Truck} title={t('promiseFastTitle')} text={t('promiseFastText')} /><MiniPromise icon={BadgeCheck} title={t('promiseFreshTitle')} text={t('promiseFreshText')} /><MiniPromise icon={Headphones} title={t('promiseHelpTitle')} text={t('promiseHelpText')} /></section>
    </div>
  </div>;
}
function MiniPromise({ icon: Icon, title, text }: { icon: typeof Truck; title: string; text: string }) { return <div className="flex items-center gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.7)] p-4"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e8efdc] text-[hsl(var(--primary))]"><Icon size={18} /></span><div><p className="text-sm font-bold">{title}</p><p className="text-xs text-[hsl(var(--muted-foreground))]">{text}</p></div></div>; }

function Catalog() {
  const params = new URLSearchParams(window.location.search);
  const [search, setSearch] = useState(params.get('search') || '');
  const [category, setCategory] = useState(params.get('category') || '');
  const sortParam = params.get('sort');
  const [sort, setSort] = useState<'popular' | 'price_asc' | 'price_desc' | 'newest' | 'discount'>(
    sortParam === 'price_asc' || sortParam === 'price_desc' || sortParam === 'newest' || sortParam === 'discount' ? sortParam : 'popular',
  );
  const categories = useListCategories({ query: { queryKey: getListCategoriesQueryKey() } });
  const products = useListProducts({ search: search || undefined, category: category || undefined, sort }, { query: { queryKey: getListProductsQueryKey({ search: search || undefined, category: category || undefined, sort }) } });
  const { t, script } = useT(storeMessages);
  return <div className="container-wide py-7 sm:py-10"><div className="animate-rise"><div className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">{t('catalogEyebrow')}</p><h1 className="display mt-2 text-4xl font-extrabold sm:text-5xl">{t('catalogTitle')}</h1></div><div className="relative w-full sm:w-[300px]"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" size={17} /><input data-testid="input-catalog-search" value={search} onChange={event => setSearch(event.target.value)} placeholder={t('searchPlaceholder')} className="h-12 w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] pl-11 pr-4 text-sm outline-none transition focus:border-[hsl(var(--primary))] focus:ring-4 focus:ring-[hsl(var(--primary)/.1)]" /></div></div><div className="mb-8 space-y-4"><div className="flex items-center gap-2 overflow-x-auto pb-1"><button data-testid="button-category-all" onClick={() => setCategory('')} className={`shrink-0 rounded-full px-4 py-2 text-xs font-bold transition ${!category ? 'bg-[hsl(var(--primary))] text-white' : 'border border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:border-[hsl(var(--primary))]'}`}>{t('seeAll')}</button>{categories.data?.map(item => <button data-testid={`button-filter-category-${item.id}`} key={item.id} onClick={() => setCategory(item.slug)} className={`shrink-0 rounded-full px-4 py-2 text-xs font-bold transition ${category === item.slug ? 'bg-[hsl(var(--primary))] text-white' : 'border border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:border-[hsl(var(--primary))]'}`}>{script(item.name)}</button>)}</div><div className="flex items-center justify-between gap-3"><p className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]"><SlidersHorizontal size={15} /> {t('productsFound', { n: products.data?.length || 0 })}</p><label className="flex items-center gap-2 text-sm"><span className="hidden text-[hsl(var(--muted-foreground))] sm:inline">{t('sortLabel')}</span><select data-testid="select-catalog-sort" value={sort} onChange={event => setSort(event.target.value as typeof sort)} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs font-bold outline-none"><option value="popular">{t('sortPopular')}</option><option value="newest">{t('sortNewest')}</option><option value="price_asc">{t('sortCheap')}</option><option value="price_desc">{t('sortExpensive')}</option><option value="discount">{t('sortDiscount')}</option></select></label></div></div>{products.isLoading ? <LoadingGrid /> : products.isError ? <QueryError retry={() => products.refetch()} /> : products.data?.length ? <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">{inStockFirst(products.data).map((product, i) => <ProductCard key={product.id} product={product} index={i} />)}</div> : <EmptyState title={t('notFoundTitle')} text={t('notFoundText')} action={t('clearFilters')} onClick={() => { setSearch(''); setCategory(''); }} />}</div></div>;
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
  const { t, money, script, lang } = useT(storeMessages);
  if (product.isLoading) return <div className="container-wide py-10"><div className="skeleton h-[520px] rounded-[30px]" /></div>;
  if (product.isError || !product.data) return <div className="container-wide py-10"><QueryError retry={() => product.refetch()} /></div>;
  const item = product.data;
  return <div className="container-wide py-7 sm:py-10"><Link href="/catalog" data-testid="link-back-catalog" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-[hsl(var(--muted-foreground))] transition hover:text-[hsl(var(--primary))]"><ArrowLeft size={16} /> {t('backToCatalog')}</Link><div className="animate-rise grid overflow-hidden rounded-[30px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] lg:grid-cols-[1.04fr_.96fr]"><ProductVisual product={item} className="min-h-[340px] lg:min-h-[590px]" /><div className="flex flex-col justify-center p-6 sm:p-10 lg:p-14"><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">{script(item.category)} / {localUnit(item.unit, lang)}</p><h1 className="display mt-3 text-4xl font-extrabold leading-tight sm:text-5xl">{script(item.name)}</h1><p className="mt-5 max-w-[500px] leading-relaxed text-[hsl(var(--muted-foreground))]">{item.description ? script(item.description) : t('defaultDescription')}</p><div className="mt-8 flex items-end gap-3"><span className="display text-3xl font-extrabold">{money(item.price)}</span>{item.old_price && <span className="mb-1 text-sm text-[hsl(var(--muted-foreground))] line-through">{money(item.old_price)}</span>}<span className="mb-1 text-sm text-[hsl(var(--muted-foreground))]">/ {localUnit(item.unit, lang)}</span></div><div className="mt-8 flex flex-col gap-3 sm:flex-row"><button data-testid="button-add-detail" onClick={() => openPicker(item)} disabled={isSoldOut(item)} className="tap flex h-14 shrink-0 items-center justify-center gap-2 rounded-2xl sm:flex-1 bg-[hsl(var(--primary))] px-6 text-sm font-extrabold text-white transition hover:shadow-[0_12px_24px_rgba(22,116,96,.22)] disabled:cursor-not-allowed disabled:bg-[#8a8f89] disabled:opacity-70">{isSoldOut(item) ? t('soldOutLong') : line ? <><Check size={18} /> {t('addedToCart')}</> : <><ShoppingBag size={18} /> {t('addToCart')}</>}</button><Link href="/cart" data-testid="link-detail-cart" className="flex h-14 items-center justify-center rounded-2xl border border-[hsl(var(--border))] px-6 text-sm font-bold transition hover:bg-[hsl(var(--muted))]">{line ? t('inCart') : t('viewCart')}</Link></div><div className="mt-8 grid grid-cols-2 gap-3 border-t border-[hsl(var(--border))] pt-6"><div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><Truck size={16} className="text-[hsl(var(--primary))]" /> {t('deliveryToday')}</div><div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><BadgeCheck size={16} className="text-[hsl(var(--primary))]" /> {item.stock > 0 ? t('inStock') : t('soldOut')}</div></div></div></div></div>;
}

function Cart() {
  const { lines, subtotal, remove, openPicker } = useCart();
  const storeStatus = useGetStoreStatus({ query: { queryKey: getGetStoreStatusQueryKey(), refetchInterval: 60_000 } });
  const closed = storeStatus.data ? !storeStatus.data.open_now : false;
  const { problems, live } = useCartAvailability(lines);
  const { t, money, script, lang } = useT(storeMessages);
  return <div className="container-wide py-7 sm:py-10"><div className="mb-8"><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">{t('cartEyebrow')}</p><h1 className="display mt-2 text-4xl font-extrabold sm:text-5xl">{t('cartTitle')}</h1></div>{lines.length === 0 ? <EmptyState title={t('cartEmptyTitle')} text={t('cartEmptyText')} action={t('goToCatalog')} href="/catalog" /> : <div className="grid gap-5 lg:grid-cols-[1fr_370px]"><section className="space-y-3">{lines.map((line) => {
    const { product, quantity, purchaseMode, amount } = line;
    const lineTotal = purchaseMode === 'amount' ? amount! : quantity * product.price;
    const isContinuous = product.unit === 'kg' || product.unit === 'litr';
    const lineLabel = purchaseMode === 'amount' ? t('amountLine', { amount: money(amount!), quantity: `${quantity} ${localUnit(product.unit, lang)}` }) : `${isContinuous ? quantity : Math.round(quantity)} ${localUnit(product.unit, lang)}`;
    return <div data-testid={`row-cart-${product.id}`} key={product.id} className="animate-rise flex gap-3 rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 sm:gap-5 sm:p-4"><ProductVisual product={live.get(product.id) ?? product} className="h-24 w-24 shrink-0 rounded-2xl sm:h-28 sm:w-28" /><div className="flex min-w-0 flex-1 flex-col justify-between py-1"><div className="flex justify-between items-start gap-2"><div><p className="text-[15px] font-bold">{script(product.name)}</p><p className="mt-1 text-xs font-semibold text-[hsl(var(--muted-foreground))]">{lineLabel}</p>{problems.get(product.id) && <p data-testid={`text-cart-problem-${product.id}`} className="mt-1.5 rounded-lg bg-[#fdf0ed] px-2 py-1 text-[11px] font-bold text-[#9d493e]">{lineProblemText(problems.get(product.id)!, product.unit, lang)}</p>}</div><button data-testid={`button-remove-cart-${product.id}`} onClick={() => remove(product.id)} className="flex h-8 w-8 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] hover:bg-[#f8e3de] hover:text-[#a64b3f] transition"><X size={16} /></button></div><div className="flex items-end justify-between mt-2"><button data-testid={`button-edit-cart-${product.id}`} onClick={() => openPicker(live.get(product.id) ?? product)} className="text-xs font-bold text-[hsl(var(--primary))] underline underline-offset-2">{t('edit')}</button><p className="display text-base font-extrabold">{money(lineTotal)}</p></div></div></div>;
  })}</section><aside className="h-fit rounded-[24px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-6 lg:sticky lg:top-24"><h2 className="display text-xl font-extrabold">{t('summaryTitle')}</h2><div className="mt-5 space-y-3 border-b border-[hsl(var(--border))] pb-5 text-sm"><div className="flex justify-between"><span className="text-[hsl(var(--muted-foreground))]">{t('products')}</span><span className="font-bold">{money(subtotal)}</span></div><div className="flex justify-between"><span className="text-[hsl(var(--muted-foreground))]">{t('delivery')}</span><span className="font-bold">{t('deliveryAtCheckout')}</span></div></div><div className="mt-5 flex justify-between"><span className="font-bold">{t('productsTotal')}</span><span data-testid="text-cart-total" className="display text-2xl font-extrabold">{money(subtotal)}</span></div><p className="mt-3 rounded-xl bg-[#fff2d4] p-3 text-xs font-semibold text-[#91600f]">{t('freeRule')}</p>{problems.size > 0 ? <p data-testid="text-cart-blocked" className="mt-5 rounded-2xl bg-[#fdf0ed] p-3.5 text-center text-xs font-bold text-[#9d493e]">{t('stockProblemCart')}</p> : <Link href="/checkout" data-testid="link-checkout" className="tap mt-5 flex h-13 items-center justify-center gap-2 rounded-2xl bg-[hsl(var(--primary))] px-5 py-3.5 text-sm font-extrabold text-white transition hover:shadow-[0_12px_24px_rgba(22,116,96,.2)]">{t('checkoutCta')} <ArrowRight size={17} /></Link>}<div className="mt-4 flex items-center justify-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><Clock3 size={14} /> {closed ? t('closedHint') : t('etaHint')}</div></aside></div>}</div>;
}

function Checkout() {
  const { lines, subtotal, clear } = useCart();
  const { problems } = useCartAvailability(lines);
  const createOrder = useCreateOrder();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { t, money, script, lang } = useT(storeMessages);
  const [savedProfile] = useState(readProfile);
  const [customerName, setCustomerName] = useState(savedProfile.name);
  const [phone, setPhone] = useState(savedProfile.phone);
  const [detailsTouched, setDetailsTouched] = useState(false);
  // The account the server knows this browser as. Its details win over what
  // this browser remembers locally, once they arrive, unless the customer has
  // started typing.
  const customer = useGetCustomerProfile({ query: { queryKey: getGetCustomerProfileQueryKey() } });
  const account = customer.data?.authenticated ? customer.data : undefined;
  useEffect(() => {
    if (!account || detailsTouched) return;
    if (account.name) setCustomerName(account.name);
    if (account.phone) setPhone(formatUzPhone(account.phone));
  }, [account, detailsTouched]);
  // Addresses this customer already uses: the account's, this browser's own,
  // and those of its past orders, most recent first.
  const myOrders = useListOrders({ query: { queryKey: getListOrdersQueryKey() } });
  const savedAddresses = useMemo(
    () => cleanAddresses([
      ...(account?.addresses ?? []),
      ...savedProfile.addresses,
      ...(myOrders.data ?? []).map(order => parseAddress(order.address)),
    ]),
    [account, savedProfile, myOrders.data],
  );
  const [addressChoice, setAddressChoice] = useState<AddressChoice>(savedProfile.addresses.length ? 0 : 'new');
  const [addressTouched, setAddressTouched] = useState(false);
  const [newAddress, setNewAddress] = useState<AddressParts>(emptyAddress);
  // Past orders arrive after the first render; until the customer picks
  // something themselves, preselect the latest address once it is known.
  useEffect(() => {
    if (!addressTouched && addressChoice === 'new' && savedAddresses.length > 0) setAddressChoice(0);
  }, [addressTouched, addressChoice, savedAddresses.length]);
  const address: AddressParts = addressChoice === 'new' ? newAddress : savedAddresses[addressChoice] ?? emptyAddress;
  const chooseAddress = (choice: AddressChoice) => { setAddressTouched(true); setAddressChoice(choice); };
  const [payment, setPayment] = useState<'cash' | 'click' | 'payme' | 'uzcard' | 'humo'>('cash');
  // Right now while the shop is open, or a pre-order for a slot in its hours.
  const storeStatus = useGetStoreStatus({ query: { queryKey: getGetStoreStatusQueryKey(), refetchInterval: 60_000 } });
  const [deliveryChoice, setDeliveryChoice] = useState<DeliveryChoice>({ mode: 'now', slot: '' });
  const deliveryReady = Boolean(storeStatus.data?.accepting_orders) && (deliveryChoice.mode === 'now' ? Boolean(storeStatus.data?.open_now) : Boolean(deliveryChoice.slot));
  const [serverError, setServerError] = useState('');
  const telegramBlocked = useTelegramBlocked();
  // True while the Mini App signs in again after finding its session gone.
  const [renewing, setRenewing] = useState(false);
  const phoneProblem = phone.trim().length >= 7 && !normalizeUzPhone(phone) ? t('phoneOnlyUz') : '';
  // The first order to a flat is free, so the fee follows the address.
  const canEstimate = isCompleteAddress(address);
  const addressLine = formatAddress(address);
  const deliveryEstimate = useGetDeliveryFeeEstimate(
    { address: addressLine },
    { query: { queryKey: getGetDeliveryFeeEstimateQueryKey({ address: addressLine }), enabled: canEstimate } },
  );
  const delivery = deliveryEstimate.data?.delivery_fee;
  
  const submit = () => {
    if (customerName.trim().length < 2 || !isCompleteAddress(address) || !normalizeUzPhone(phone) || !lines.length || problems.size > 0 || !deliveryReady) return;
    // Saved before the request rather than after it, so a rejected order still
    // leaves the details filled in for the next attempt.
    writeProfile({ name: customerName, phone, addresses: rememberAddress(savedAddresses, address) });
    setServerError('');
    const send = (afterRenewal: boolean) => createOrder.mutate({ 
      data: { 
        customer_name: customerName.trim(), 
        address: formatAddress(address), 
        phone, 
        payment_method: payment, 
        scheduled_for: deliveryChoice.mode === 'later' ? deliveryChoice.slot : null,
        items: lines.map(line => ({ 
          product_id: line.product.id, 
          purchase_mode: line.purchaseMode,
          ...(line.purchaseMode === 'amount' ? { amount: line.amount } : { quantity: line.quantity })
        })) 
      } 
    }, { 
      onSuccess: order => {
        clear();
        // The order created or updated this browser's account.
        qc.invalidateQueries({ queryKey: getGetCustomerProfileQueryKey() });
        qc.invalidateQueries({ queryKey: getListOrdersQueryKey() });
        setLocation(`/orders/${order.id}`);
      },
      // The API answers { error } in Uzbek, e.g. that stock ran out.
      onError: async err => {
        // Inside the Mini App the session can be gone (an admin signed this
        // device out). Telegram's launch data signs it in again, and the
        // order is sent once more.
        const sessionGone = isSessionLost(err);
        if (sessionGone && isMiniApp() && !afterRenewal) {
          setRenewing(true);
          const renewed = await renewTelegramSession(qc);
          setRenewing(false);
          if (renewed === 'ok') return send(true);
          return setServerError(renewed === 'blocked'
            ? t('blockedOrder')
            : renewed === 'stale' ? t('sessionStale') : t('networkRetry'));
        }
        setServerError(apiErrorMessage(err, t('orderFailed')));
      },
    });
    send(false);
  };
  
  if (!lines.length) return <div className="container-wide py-10"><EmptyState title={t('checkoutEmptyTitle')} text={t('checkoutEmptyText')} action={t('goToCatalog')} href="/catalog" /></div>;
  return <div className="container-wide py-7 sm:py-10"><Link href="/cart" data-testid="link-back-cart" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-[hsl(var(--muted-foreground))]"><ArrowLeft size={16} /> {t('backToCart')}</Link><div className="mb-7"><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">{t('step')}</p><h1 className="display mt-2 text-4xl font-extrabold sm:text-5xl">{t('checkoutTitle')}</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">{t('checkoutText')}</p></div><div className="grid gap-5 lg:grid-cols-[1fr_370px]"><section className="space-y-5"><div className="rounded-[24px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7"><SectionTitle number="01" title={t('sectionAddress')} /><label className="mt-5 block text-sm font-bold">{t('fullName')}<input data-testid="input-customer-name" value={customerName} onChange={event => { setDetailsTouched(true); setCustomerName(event.target.value); }} placeholder={t('namePlaceholder')} maxLength={80} autoComplete="name" className="mt-2 h-12 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 text-sm outline-none focus:border-[hsl(var(--primary))]" /></label><div className="mt-4"><p className="text-sm font-bold">{t('address')}</p><AddressPicker saved={savedAddresses} choice={addressChoice} onChoice={chooseAddress} draft={newAddress} onDraft={parts => { setAddressTouched(true); setNewAddress(parts); }} /></div><label className="mt-4 block text-sm font-bold"><span className="flex items-center justify-between gap-2">{t('phone')}</span><input data-testid="input-phone" value={phone} onChange={event => { setDetailsTouched(true); setPhone(event.target.value); }} type="tel" autoComplete="tel" placeholder="+998 90 123 45 67" className="mt-2 h-12 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 text-sm outline-none focus:border-[hsl(var(--primary))]" /></label>{phoneProblem && <p className="mt-2 text-xs font-semibold text-[#9d493e]">{phoneProblem}</p>}<p data-testid="text-delivery-rule" className="mt-3 rounded-xl bg-[#e8efdc] p-3 text-xs font-semibold text-[hsl(var(--primary))]">{deliveryEstimate.data?.is_first_order ? t('deliveryRuleFirst') : t('freeRule')}</p></div><div data-testid="section-delivery-time" className="rounded-[24px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7"><SectionTitle number="02" title={t('sectionTime')} /><DeliveryTime status={storeStatus.data} failed={storeStatus.isError} onRetry={() => storeStatus.refetch()} value={deliveryChoice} onChange={setDeliveryChoice} /></div><div className="rounded-[24px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7"><SectionTitle number="03" title={t('sectionPayment')} /><div className="mt-5 grid gap-2 sm:grid-cols-2">{[['cash', t('cash'), Banknote], ['click', 'Click', CreditCard], ['payme', 'Payme', WalletCards], ['uzcard', 'Uzcard', CreditCard], ['humo', 'Humo', CreditCard]].map(([value, label, Icon]) => <button data-testid={`button-payment-${value}`} key={value as string} onClick={() => setPayment(value as typeof payment)} className={`flex items-center gap-3 rounded-xl border p-3.5 text-left text-sm font-bold transition ${payment === value ? 'border-[hsl(var(--primary))] bg-[#e8efdc] text-[hsl(var(--primary))]' : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]'}`}><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(var(--card))]"><Icon size={16} /></span>{label as string}{payment === value && <Check size={16} className="ml-auto" />}</button>)}</div></div>{account?.blocked && <div data-testid="text-checkout-blocked" className="rounded-2xl border border-[#e6b2a8] bg-[#fdf0ed] p-4 text-sm font-semibold text-[#9d493e]">{t('blockedOrder')}</div>}{problems.size > 0 && <div data-testid="text-checkout-stock-problem" className="rounded-2xl border border-[#e6b2a8] bg-[#fdf0ed] p-4 text-sm font-semibold text-[#9d493e]">{t('stockProblemCheckout')} <Link href="/cart" className="underline underline-offset-2">{t('backToCartLink')}</Link> {t('changeThem')}</div>}{serverError && <div className="rounded-2xl border border-[#e6b2a8] bg-[#fdf0ed] p-4 text-sm font-semibold text-[#9d493e]">{serverError}</div>}</section><aside className="h-fit rounded-[24px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-6 lg:sticky lg:top-24"><SectionTitle number="04" title={t('sectionOrder')} /><div className="mt-5 space-y-3">{lines.map(line => {
    const lineTotal = line.purchaseMode === 'amount' ? line.amount! : line.quantity * line.product.price;
    const lineLabel = line.purchaseMode === 'amount' ? t('amountShort', { amount: money(line.amount!) }) : `${line.quantity} ${localUnit(line.product.unit, lang)}`;
    return <div key={line.product.id} className="flex justify-between gap-3 text-sm"><span className="truncate text-[hsl(var(--muted-foreground))]">{script(line.product.name)} ({lineLabel})</span><span className="shrink-0 font-bold">{money(lineTotal)}</span></div>;
  })}</div><div className="mt-5 space-y-3 border-t border-[hsl(var(--border))] pt-5 text-sm"><div className="flex justify-between"><span className="text-[hsl(var(--muted-foreground))]">{t('delivery')}</span><span className="font-bold">{delivery === undefined ? (canEstimate ? t('calculating') : t('chooseAddress')) : delivery === 0 ? t('free') : money(delivery)}</span></div><div className="flex justify-between"><span className="font-bold">{t('total')}</span><span data-testid="text-checkout-total" className="display text-2xl font-extrabold">{delivery === undefined ? '—' : money(subtotal + delivery)}</span></div></div>{isMiniApp() ? <button data-testid="button-submit-order" onClick={submit} disabled={createOrder.isPending || renewing || telegramBlocked || customerName.trim().length < 2 || !isCompleteAddress(address) || !normalizeUzPhone(phone) || problems.size > 0 || !deliveryReady || Boolean(account?.blocked)} className="tap mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[hsl(var(--primary))] text-sm font-extrabold text-white transition hover:shadow-[0_12px_24px_rgba(22,116,96,.2)] disabled:cursor-not-allowed disabled:opacity-50">{createOrder.isPending || renewing ? <><LoaderCircle size={18} className="animate-spin" /> {t('sending')}</> : <>{t('placeOrder')} <ArrowRight size={17} /></>}</button> : <div className="mt-6"><OpenInTelegram title={t('orderInTelegramTitle')} hint={t('orderInTelegramHint')} /></div>}</aside></div></div>;
}
function SectionTitle({ number, title }: { number: string; title: string }) { return <div className="flex items-center gap-3"><span className="mono flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(var(--secondary))] text-[11px] font-bold">{number}</span><h2 className="display text-xl font-extrabold">{title}</h2></div>; }

function Orders() {
  const orders = useListOrders({ query: { queryKey: getListOrdersQueryKey() } });
  const { t } = useT(storeMessages);
  return <div className="container-wide py-7 sm:py-10"><div className="mb-8 flex items-end justify-between"><div><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">{t('ordersEyebrow')}</p><h1 className="display mt-2 text-4xl font-extrabold sm:text-5xl">{t('ordersTitle')}</h1></div><Link href="/catalog" data-testid="link-orders-shop" className="hidden items-center gap-2 rounded-full bg-[hsl(var(--secondary))] px-4 py-2.5 text-sm font-bold sm:flex">{t('shopMore')} <ArrowRight size={15} /></Link></div>{orders.isLoading ? <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="skeleton h-28 rounded-[22px]" />)}</div> : orders.isError ? <QueryError retry={() => orders.refetch()} /> : orders.data?.length ? <div className="space-y-3">{orders.data.map((order, i) => <OrderRow key={order.id} order={order} index={i} />)}</div> : <EmptyState title={t('ordersEmptyTitle')} text={t('ordersEmptyText')} action={t('browseCatalog')} href="/catalog" />}</div>;
}
function OrderRow({ order, index = 0 }: { order: Order; index?: number }) { const { t, money, lang, locale } = useT(storeMessages); return <Link href={`/orders/${order.id}`} data-testid={`link-order-${order.id}`} className={`animate-rise delay-${Math.min(index + 1, 6)} group flex flex-col gap-4 rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 transition hover:-translate-y-0.5 hover:border-[hsl(var(--primary)/.35)] sm:flex-row sm:items-center sm:justify-between sm:p-5`}><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e8efdc] text-[hsl(var(--primary))]"><Package size={20} /></span><div><p className="text-sm font-extrabold">#{order.order_number}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{when(order.created_at, locale)} · {t('itemsCount', { n: order.items.length })}{order.scheduled_for && <span data-testid={`badge-scheduled-${order.id}`} className="ml-1 inline-flex items-center gap-1 rounded-full bg-[#fff0d4] px-2 py-0.5 text-[10px] font-bold text-[#a25e08]">⏰ {deliveryLabel(new Date(order.scheduled_for), undefined, lang)}</span>}</p></div></div><div className="flex items-center justify-between gap-5 sm:justify-end"><div className="text-left sm:text-right"><span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${statusTone[order.status]}`}>{t(statusKey[order.status])}</span><p className="mt-1 display text-base font-extrabold">{money(order.total)}</p></div><ChevronRight size={18} className="text-[hsl(var(--muted-foreground))] transition group-hover:translate-x-1 group-hover:text-[hsl(var(--primary))]" /></div></Link>; }

function OrderDetail() {
  const params = useParams<{ id: string }>(); const id = Number(params.id);
  const order = useGetOrder(id, { query: { queryKey: getGetOrderQueryKey(id), enabled: Number.isFinite(id), refetchInterval: 10000, refetchOnWindowFocus: true } });
  const { t, money, script, lang, locale } = useT(storeMessages);
  // "12-dom, 5-xonadon" as the order stores it, in the customer's language.
  const addressText = (value: string) => { const parts = parseAddress(value); return isCompleteAddress(parts) ? t('addressFormat', parts) : value; };
  if (order.isLoading) return <div className="container-wide py-10"><div className="skeleton h-[500px] rounded-[28px]" /></div>;
  if (order.isError || !order.data) return <div className="container-wide py-10"><QueryError retry={() => order.refetch()} /></div>;
  const item = order.data; const steps = ['new', 'preparing', 'courier', 'delivered']; const current = steps.indexOf(item.status);
  return <div className="container-wide py-7 sm:py-10"><Link href="/orders" data-testid="link-back-orders" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-[hsl(var(--muted-foreground))]"><ArrowLeft size={16} /> {t('ordersTitle')}</Link><div className="mb-7 flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">{t('orderDetailEyebrow')}</p><h1 className="display mt-2 text-4xl font-extrabold">#{item.order_number}</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">{when(item.created_at, locale)}</p>{item.scheduled_for && <p data-testid="text-order-scheduled" className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#fff0d4] px-3 py-1 text-xs font-bold text-[#a25e08]">{t('preorderAt', { time: deliveryLabel(new Date(item.scheduled_for), undefined, lang) })}</p>}</div><span data-testid="status-order" className={`w-fit rounded-full px-3 py-1.5 text-xs font-bold ${statusTone[item.status]}`}>{t(statusKey[item.status])}</span></div><div className="grid gap-5 lg:grid-cols-[1fr_360px]"><section className="space-y-5"><div className="rounded-[24px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7"><h2 className="display text-xl font-extrabold">{t('deliveryStatus')}</h2><div className="mt-7">{item.status === 'cancelled' ? <div className="rounded-2xl bg-[#fdf0ed] p-4 text-sm font-semibold text-[#9d493e]">{t('cancelledNote')}</div> : <div className="relative grid grid-cols-4">{steps.map((step, i) => <div key={step} className="relative flex flex-col items-center text-center"><div className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-4 border-[hsl(var(--card))] ${i <= current ? 'bg-[hsl(var(--primary))] text-white' : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'}`}>{i <= current ? <Check size={16} /> : <span className="text-xs font-bold">{i + 1}</span>}</div><span className={`mt-2 text-[10px] font-bold sm:text-xs ${i <= current ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))]'}`}>{t(statusKey[step as keyof typeof statusKey])}</span>{i < 3 && <span className={`absolute left-1/2 top-5 h-1 w-full ${i < current ? 'bg-[hsl(var(--primary))]' : 'bg-[hsl(var(--muted))]'}`} />}</div>)}</div>}</div></div><div className="rounded-[24px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7"><h2 className="display text-xl font-extrabold">{t('products')}</h2><div className="mt-5 divide-y divide-[hsl(var(--border))]">{item.items.map(line => {
    const isContinuous = line.unit === 'kg' || line.unit === 'litr';
    const lineLabel = line.purchase_mode === 'amount' 
      ? t('amountLine', { amount: money(line.requested_amount!), quantity: `${line.quantity} ${localUnit(line.unit, lang)}` })
      : `${isContinuous ? line.quantity : Math.round(line.quantity)} ${localUnit(line.unit, lang)}`;
    return <div key={line.product_id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"><div><p className="text-sm font-bold">{script(line.name)}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{lineLabel} · {money(line.price)} / {localUnit(line.unit, lang)}</p></div><p className="text-sm font-extrabold">{money(line.total)}</p></div>;
  })}</div></div></section><aside className="h-fit space-y-3 lg:sticky lg:top-24">{item.status === 'delivered' && <OrderFeedback orderId={item.id} />}<div className="rounded-[24px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5"><h2 className="display text-lg font-extrabold">{t('address')}</h2><p className="mt-3 flex gap-2 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]"><MapPin size={16} className="mt-0.5 shrink-0 text-[hsl(var(--primary))]" />{addressText(item.address)}</p><p className="mt-3 flex gap-2 text-sm text-[hsl(var(--muted-foreground))]"><Phone size={16} className="shrink-0 text-[hsl(var(--primary))]" />{formatUzPhone(item.phone)}</p></div><div className="rounded-[24px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5"><h2 className="display text-lg font-extrabold">{t('paymentTitle')}</h2><div className="mt-4 space-y-2 text-sm"><div className="flex justify-between"><span className="text-[hsl(var(--muted-foreground))]">{t('products')}</span><b>{money(item.subtotal)}</b></div><div className="flex justify-between"><span className="text-[hsl(var(--muted-foreground))]">{t('deliveryShort')}</span><b>{money(item.delivery_fee)}</b></div><div className="flex justify-between border-t border-[hsl(var(--border))] pt-3"><span className="font-bold">{t('total')}</span><b className="display text-xl">{money(item.total)}</b></div></div></div></aside></div></div>;
}

function Profile() {
  const qc = useQueryClient();
  const customer = useGetCustomerProfile({ query: { queryKey: getGetCustomerProfileQueryKey() } });
  const account = customer.data?.authenticated ? customer.data : undefined;
  const updateProfile = useUpdateCustomerProfile();
  const replaceAddresses = useReplaceCustomerAddresses();
  const logout = useCustomerLogout();
  const { t, lang } = useT(storeMessages);
  // The form starts from this browser's memory and switches to the account's
  // details once they arrive, unless the customer has started typing.
  const [local] = useState<CustomerProfile>(readProfile);
  const [name, setName] = useState(local.name);
  const [phone, setPhone] = useState(local.phone);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!account || touched) return;
    setName(account.name);
    setPhone(account.phone ? formatUzPhone(account.phone) : '');
  }, [account, touched]);
  const addresses = account ? account.addresses : local.addresses;
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);
  const [newAddress, setNewAddress] = useState<AddressParts>(emptyAddress);
  const leaderboard = useGetWeeklyLeaderboard({ query: { queryKey: getGetWeeklyLeaderboardQueryKey() } });
  const displayName = (account?.name || name).trim();

  const afterSave = (profile: ApiCustomerProfile, text: string) => {
    qc.setQueryData(getGetCustomerProfileQueryKey(), profile);
    // Kept in step so checkout still prefills if the network is slow.
    writeProfile({ name: profile.name, phone: profile.phone, addresses: profile.addresses });
    setFeedback({ text });
  };
  const failed = (err: unknown, fallback: string) => setFeedback({ text: apiErrorMessage(err, fallback), error: true });

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const error = profileFieldError({ name, phone }, lang);
    if (error) return setFeedback({ text: error, error: true });
    if (phone.trim() && !normalizeUzPhone(phone)) return setFeedback({ text: t('phoneOnlyUz'), error: true });
    updateProfile.mutate({ data: { name: name.trim(), phone: phone.trim() } }, {
      onSuccess: profile => { setTouched(false); afterSave(profile, t('saved')); },
      onError: err => failed(err, t('saveFailed')),
    });
  };
  // Address changes are saved at once, without the Save button.
  const saveAddresses = (next: AddressParts[], text: string) => {
    replaceAddresses.mutate({ data: { addresses: next } }, {
      onSuccess: profile => afterSave(profile, text),
      onError: err => failed(err, t('addressSaveFailed')),
    });
  };
  const addAddress = () => {
    if (!isCompleteAddress(newAddress)) return setFeedback({ text: t('chooseDomFlat'), error: true });
    saveAddresses(rememberAddress(addresses, newAddress), t('addressAdded'));
    setNewAddress(emptyAddress);
  };
  // Ends this device's session and forgets its details, for a shared phone.
  const signOut = () => {
    logout.mutate(undefined, {
      onSuccess: profile => {
        clearProfile();
        qc.setQueryData(getGetCustomerProfileQueryKey(), profile);
        qc.removeQueries({ queryKey: getListOrdersQueryKey() });
        qc.removeQueries({ queryKey: getGetChatTranscriptQueryKey() });
        try { localStorage.removeItem('qorasuv-chat-started'); } catch { /* storage may be unavailable */ }
        setName(''); setPhone(''); setTouched(false);
        setFeedback({ text: t('signedOut') });
      },
      onError: err => failed(err, t('signOutFailed')),
    });
  };

  const field = 'mt-2 h-12 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 text-sm outline-none focus:border-[hsl(var(--primary))] disabled:opacity-70';
  const busy = updateProfile.isPending || replaceAddresses.isPending || logout.isPending;

  return <div className="container-wide py-7 sm:py-10">
    <div className="mb-8"><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">{t('profileEyebrow')}</p><h1 className="display mt-2 text-4xl font-extrabold sm:text-5xl">{t('profileTitle')}</h1></div>
    <div className="grid gap-5 lg:grid-cols-[.82fr_1.18fr]">
      <section className="h-fit rounded-[26px] bg-[hsl(var(--primary))] p-6 text-white sm:p-8">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#f4cc73] text-2xl font-extrabold text-[#25483e]">{(displayName || 'I').charAt(0).toUpperCase()}</div>
        <h2 data-testid="text-profile-name" className="display mt-6 text-3xl font-extrabold">{displayName || t('noName')}</h2>
        {account?.phone && <p className="mt-2 flex items-center gap-2 text-sm text-[#d9e5ce]">{formatUzPhone(account.phone)}</p>}
        {addresses[0] && <p className="mt-1 text-sm text-[#d9e5ce]">{t('addressFormat', { dom: addresses[0].dom, xonadon: addresses[0].xonadon })}{addresses.length > 1 ? ` (+${addresses.length - 1})` : ''}</p>}
        {!account && <p className="mt-2 text-sm text-[#d9e5ce]">{t('saveHint')}</p>}
        <Link href="/orders" data-testid="link-profile-orders" className="mt-8 flex items-center justify-between rounded-2xl bg-white/10 p-4 text-sm font-bold transition hover:bg-white/15">{t('ordersTitle')} <ArrowRight size={17} /></Link>
      </section>
      <section className="space-y-3">
        {account?.blocked && <p data-testid="text-profile-blocked" className="rounded-[22px] border border-[#e6b2a8] bg-[#fdf0ed] p-5 text-sm font-semibold text-[#9d493e]">{t('profileBlocked')}</p>}
        <LanguageSwitcher />
        <OpenInTelegram title={t('openTelegramTitle')} hint={t('openTelegramHint')} />
        {isMiniApp() && <form onSubmit={save} data-testid="form-profile" className="rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-extrabold">{t('personal')}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{account?.telegram_linked ? t('linkedHint') : t('unlinkedHint')}</p></div><UserRound size={19} className="shrink-0 text-[hsl(var(--primary))]" /></div>
          <label className="mt-5 block text-sm font-bold">{t('fullName')}<input data-testid="input-profile-name" value={name} onChange={event => { setTouched(true); setName(event.target.value); }} placeholder={t('namePlaceholder')} maxLength={80} autoComplete="name" className={field} /></label>
          <label className="mt-4 block text-sm font-bold">{t('phone')}<input data-testid="input-profile-phone" value={phone} onChange={event => { setTouched(true); setPhone(event.target.value); }} type="tel" placeholder="+998 90 123 45 67" autoComplete="tel" className={field} /></label>
          <div className="mt-4"><p className="text-sm font-bold">{t('savedAddresses')}</p>
            <SavedAddressList addresses={addresses} onRemove={removed => saveAddresses(forgetAddress(addresses, removed), t('addressRemoved'))} onMakeFirst={chosen => saveAddresses(rememberAddress(addresses, chosen), t('mainAddressChanged'))} />
            <p className="mt-4 text-xs font-bold text-[hsl(var(--muted-foreground))]">{t('addNewAddress')}</p>
            <AddressSelects idPrefix="profile" value={newAddress} onChange={setNewAddress} />
            <button type="button" data-testid="button-add-address" onClick={addAddress} disabled={!isCompleteAddress(newAddress) || busy || Boolean(account?.blocked)} className="mt-2 w-full rounded-xl border border-[hsl(var(--primary)/.4)] py-2.5 text-xs font-bold text-[hsl(var(--primary))] disabled:opacity-40">{t('addAddressButton')}</button>
          </div>
          {feedback && <p role="status" data-testid="text-profile-feedback" className={`mt-4 rounded-xl p-3 text-xs font-semibold ${feedback.error ? 'bg-[#fdf0ed] text-[#9d493e]' : 'bg-[#e8efdc] text-[hsl(var(--primary))]'}`}>{!feedback.error && <Check size={14} className="mr-1.5 inline" />}{feedback.text}</p>}
          <div className="mt-5 flex gap-2">
            <button data-testid="button-profile-save" disabled={busy || Boolean(account?.blocked)} className="tap h-12 flex-1 rounded-xl bg-[hsl(var(--primary))] text-sm font-extrabold text-white transition hover:shadow-[0_12px_24px_rgba(22,116,96,.2)] disabled:opacity-60">{t('save')}</button>
            {account && !isMiniApp() && <button type="button" data-testid="button-profile-logout" onClick={signOut} disabled={busy} className="h-12 rounded-xl border border-[hsl(var(--border))] px-4 text-xs font-bold text-[hsl(var(--muted-foreground))] transition hover:border-[#b3261e] hover:text-[#b3261e] disabled:opacity-60">{t('signOutDevice')}</button>}
          </div>
        </form>}
        <ProfileSetting icon={Headphones} title={t('helpTitle')} description={t('helpText')} action={t('view')} />
        <ProfileSetting icon={Info} title={t('aboutTitle')} description={t('aboutText')} action={t('read')} />
        <WeeklyLeaderboard entries={leaderboard.data} loading={leaderboard.isLoading} />
      </section>
    </div>
  </div>;
}
function ProfileSetting({ icon: Icon, title, description, action, toggle, onClick }: { icon: typeof MapPin; title: string; description: string; action?: string; toggle?: boolean; onClick?: () => void }) { return <div className="flex items-center gap-4 rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 sm:p-5"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#e8efdc] text-[hsl(var(--primary))]"><Icon size={19} /></span><div className="min-w-0 flex-1"><p className="text-sm font-extrabold">{title}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{description}</p></div>{toggle ? <button data-testid={`button-toggle-${title}`} className="relative h-6 w-11 rounded-full bg-[hsl(var(--primary))]"><span className="absolute right-1 top-1 h-4 w-4 rounded-full bg-white" /></button> : action && <button data-testid={`button-profile-${title}`} onClick={onClick} className="rounded-full border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-bold transition hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary))]">{action}</button>}</div>; }

function AdminDashboard() {
  const dashboard = useGetAdminDashboard({ query: { queryKey: getGetAdminDashboardQueryKey() } });
  const orders = useListAdminOrders(undefined, { query: { queryKey: getListAdminOrdersQueryKey() } });
  const leaderboard = useGetWeeklyLeaderboard({ query: { queryKey: getGetWeeklyLeaderboardQueryKey() } });
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey() } });
  const [filter, setFilter] = useState<'all' | OrderStatus>('all');
  const metrics = dashboard.data;
  const shown = (orders.data || []).filter(order => filter === 'all' || order.status === filter);
  const changeStatus = useChangeOrderStatus();
  return <div className="container-wide py-7 sm:py-10"><div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Operator workspace / Bugun</p><h1 className="display mt-2 text-4xl font-extrabold sm:text-5xl">Salom, do‘kon.</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Bugungi oqimni bir qarashda boshqaring.</p></div><div className="flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs font-bold"><span className={`h-2 w-2 rounded-full ${health.isError ? 'bg-[#c85d50]' : 'bg-[#3c9d70]'}`} /> {health.isError ? 'Server tekshirilmoqda' : 'Tizim ishlayapti'}</div></div>{dashboard.isLoading ? <AdminSkeleton /> : dashboard.isError || !metrics ? <QueryError retry={() => dashboard.refetch()} /> : <><div className="mb-5 rounded-[22px] border border-[hsl(var(--primary)/.18)] bg-[#e8efdc] p-4 text-sm text-[hsl(var(--primary))]"><p className="font-extrabold">Admin panel qoidalari</p><p className="mt-1 leading-relaxed">Buyurtma holatini faqat ketma-ket yangilash mumkin: <b>Tayyorlanmoqda</b>, so‘ng <b>Kuryerga berildi</b>, va yakunida <b>Yetkazildi</b>.</p></div><StoreHoursCard /><Metrics metrics={metrics} /><div className="mt-8 grid gap-5 lg:grid-cols-[1fr_310px]"><section className="rounded-[26px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Live queue</p><h2 className="display mt-1 text-2xl font-extrabold">Buyurtmalar oqimi</h2></div><select data-testid="select-admin-filter" value={filter} onChange={event => setFilter(event.target.value as typeof filter)} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-xs font-bold"><option value="all">Barcha holatlar</option><option value="new">Yangi</option><option value="preparing">Tayyorlanmoqda</option><option value="courier">Kuryerga berildi</option><option value="delivered">Yetkazildi</option><option value="cancelled">Bekor qilingan</option></select></div>{orders.isLoading ? <div className="mt-5 space-y-3">{[1,2,3].map(i => <div className="skeleton h-20 rounded-2xl" key={i} />)}</div> : orders.isError ? <div className="mt-5"><QueryError retry={() => orders.refetch()} /></div> : shown.length ? <div className="mt-5 space-y-2">{shown.map(order => <AdminOrderRow key={order.id} order={order} onStatus={changeStatus.run} pending={changeStatus.pending} />)}</div> : <div className="mt-5"><EmptyState title="Bu filtrda buyurtmalar yo‘q" text="Boshqa holatni tanlab ko‘ring." /></div>}</section><aside className="space-y-3"><div className="rounded-[26px] bg-[#f4cc73] p-6 text-[#25483e]"><p className="mono text-[10px] font-bold uppercase tracking-[.16em]">O‘sish</p><p className="display mt-4 text-4xl font-extrabold">{money(metrics.weekly_revenue)}</p><p className="mt-1 text-sm font-semibold">haftalik tushum · faqat yetkazilgan</p><div className="mt-6 flex h-20 items-end gap-1.5">{[28,43,35,59,48,75,66,88,62,78,94,82].map((height, i) => <span key={i} className={`flex-1 rounded-t-md ${i === 11 ? 'bg-[#1f6657]' : 'bg-[#fff1bf]/80'}`} style={{ height: `${height}%` }} />)}</div></div><div className="rounded-[26px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6"><div className="flex items-center justify-between"><h2 className="display text-lg font-extrabold">Ombor signali</h2><Boxes size={19} className="text-[hsl(var(--accent))]" /></div><p className="mt-5 display text-4xl font-extrabold">{metrics.low_stock_count}</p><p className="text-sm text-[hsl(var(--muted-foreground))]">mahsulotda zaxira kam</p><Link href="/admin/catalog" data-testid="link-admin-inventory" className="mt-5 flex items-center gap-2 text-sm font-bold text-[hsl(var(--primary))]">Inventarni ko‘rish <ArrowRight size={15} /></Link></div></aside></div><div className="mt-5"><WeeklyLeaderboard entries={leaderboard.data} loading={leaderboard.isLoading} /></div></>}</div>;
}

function AdminCatalogManager() {
  const categories = useListCategories({ query: { queryKey: getListCategoriesQueryKey() } });
  const products = useListAdminProducts({ query: { queryKey: getListAdminProductsQueryKey() } });
  const createCategory = useCreateAdminCategory();
  const createProduct = useCreateAdminProduct();
  const qc = useQueryClient();
  const [categoryName, setCategoryName] = useState('');
  const [categorySlug, setCategorySlug] = useState('');
  const [categoryIcon, setCategoryIcon] = useState('leaf');
  const [product, setProduct] = useState({ category_id: '', name: '', description: '', price: '', old_price: '', unit: 'dona', stock: '0' });
  const [productImage, setProductImage] = useState<File | null>(null);
  const [productFlags, setProductFlags] = useState({ is_popular: false, is_new: true });
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState('');
  const slugify = (value: string) => value.toLowerCase().trim().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const invalidateCatalog = () => { qc.invalidateQueries({ queryKey: getListCategoriesQueryKey() }); qc.invalidateQueries({ queryKey: getListProductsQueryKey() }); qc.invalidateQueries({ queryKey: getListAdminProductsQueryKey() }); };
  const submitCategory = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createCategory.mutate({ data: { name: categoryName, slug: categorySlug || slugify(categoryName), icon: categoryIcon } }, {
      onSuccess: () => { setCategoryName(''); setCategorySlug(''); setFeedback('Kategoriya qo‘shildi.'); invalidateCatalog(); },
    });
  };
  const submitProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!product.category_id) return setFeedback('Mahsulot uchun kategoriya tanlang.');
    if (!productImage) return setFeedback('Mahsulot uchun rasm tanlang.');
    const isContinuous = product.unit === 'kg' || product.unit === 'litr';
    const parsedStock = parseFloat(product.stock);
    if (!Number.isFinite(parsedStock) || parsedStock < 0 || (!isContinuous && !Number.isInteger(parsedStock))) {
      return setFeedback('Miqdor xato kiritildi.');
    }
    // Upload first: a product row is never created pointing at an image that
    // failed to arrive.
    setUploading(true);
    let uploaded;
    try {
      uploaded = await uploadProductImage(productImage);
    } catch (error) {
      setUploading(false);
      return setFeedback(error instanceof Error ? error.message : 'Rasm yuklanmadi.');
    }
    setUploading(false);
    createProduct.mutate({ data: { category_id: Number(product.category_id), name: product.name, description: product.description, image_url: uploaded.url, image_public_id: uploaded.publicId, price: Number(product.price), old_price: product.old_price ? Number(product.old_price) : null, unit: product.unit as 'dona' | 'kg' | 'litr' | 'qadoq', stock: Number(parsedStock.toFixed(3)), is_popular: productFlags.is_popular, is_new: productFlags.is_new } }, {
      onSuccess: () => { setProduct({ category_id: product.category_id, name: '', description: '', price: '', old_price: '', unit: 'dona', stock: '0' }); setProductImage(null); setProductFlags({ is_popular: false, is_new: true }); setFeedback('Mahsulot qo‘shildi.'); invalidateCatalog(); },
      onError: () => setFeedback('Mahsulotni saqlab bo‘lmadi.'),
    });
  };
  return <div className="container-wide py-7 sm:py-10"><section data-testid="admin-catalog-manager" className="rounded-[26px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-7"><div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end"><div><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Katalog boshqaruvi</p><h2 className="display mt-1 text-2xl font-extrabold">Kategoriya va mahsulotlar</h2><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Yangi kategoriya qo‘shing, mahsulot yarating, rasmi bilan tahrirlang yoki o‘chiring.</p></div>{feedback && <p role="status" className="rounded-full bg-[#e8efdc] px-3 py-1.5 text-xs font-bold text-[hsl(var(--primary))]">{feedback}</p>}</div><div className="mt-6 grid gap-4 lg:grid-cols-2"><form onSubmit={submitCategory} className="rounded-2xl bg-[hsl(var(--muted)/.55)] p-4"><h3 className="text-sm font-extrabold">Kategoriya qo‘shish</h3><div className="mt-4 grid gap-3 sm:grid-cols-2"><input required minLength={2} value={categoryName} onChange={event => { setCategoryName(event.target.value); if (!categorySlug) setCategorySlug(slugify(event.target.value)); }} placeholder="Masalan: Muzlatilgan" className="h-11 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm outline-none focus:border-[hsl(var(--primary))]" /><input required minLength={2} pattern="[a-z0-9-]+" value={categorySlug} onChange={event => setCategorySlug(event.target.value)} placeholder="muzlatilgan" className="h-11 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm outline-none focus:border-[hsl(var(--primary))]" /></div><div className="mt-3 flex gap-3"><input required value={categoryIcon} onChange={event => setCategoryIcon(event.target.value)} placeholder="Icon nomi" className="h-11 min-w-0 flex-1 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm outline-none focus:border-[hsl(var(--primary))]" /><button disabled={createCategory.isPending} className="rounded-xl bg-[hsl(var(--primary))] px-4 text-xs font-extrabold text-white disabled:opacity-50">{createCategory.isPending ? 'Saqlanmoqda…' : 'Qo‘shish'}</button></div></form><form onSubmit={submitProduct} className="rounded-2xl bg-[hsl(var(--muted)/.55)] p-4"><h3 className="text-sm font-extrabold">Mahsulot qo‘shish</h3><div className="mt-4 grid gap-3 sm:grid-cols-2"><select required value={product.category_id} onChange={event => setProduct({ ...product, category_id: event.target.value })} className="h-11 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm"><option value="">Kategoriya tanlang</option>{categories.data?.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select><input required minLength={2} value={product.name} onChange={event => setProduct({ ...product, name: event.target.value })} placeholder="Mahsulot nomi" className="h-11 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm outline-none" /><input required minLength={2} value={product.description} onChange={event => setProduct({ ...product, description: event.target.value })} placeholder="Qisqa tavsif" className="h-11 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm outline-none" /><div className="sm:col-span-2"><AdminImageField file={productImage} onPick={setProductImage} disabled={uploading || createProduct.isPending} /></div><input required min="0" type="number" value={product.price} onChange={event => setProduct({ ...product, price: event.target.value })} placeholder="Narxi (so‘m)" className="h-11 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm outline-none" /><input min="0" type="number" value={product.old_price} onChange={event => setProduct({ ...product, old_price: event.target.value })} placeholder="Eski narx (ixtiyoriy)" className="h-11 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm outline-none" /><select value={product.unit} onChange={event => setProduct({ ...product, unit: event.target.value })} className="h-11 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm"><option value="dona">Dona</option><option value="kg">Kg</option><option value="litr">Litr</option><option value="qadoq">Qadoq</option></select><input required min="0" type="number" step={product.unit === 'kg' || product.unit === 'litr' ? "0.001" : "1"} value={product.stock} onChange={event => setProduct({ ...product, stock: event.target.value })} placeholder="Qoldiq" className="h-11 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm outline-none" /></div><div className="mt-3 flex flex-wrap gap-2"><FlagToggle on={productFlags.is_popular} label="Mashhur" icon={Star} onToggle={() => setProductFlags({ ...productFlags, is_popular: !productFlags.is_popular })} testId="toggle-create-popular" /><FlagToggle on={productFlags.is_new} label="Yangi" icon={Sparkles} onToggle={() => setProductFlags({ ...productFlags, is_new: !productFlags.is_new })} testId="toggle-create-new" /></div><button disabled={uploading || createProduct.isPending} className="mt-3 h-11 w-full rounded-xl bg-[hsl(var(--primary))] text-xs font-extrabold text-white disabled:opacity-50">{uploading ? 'Rasm yuklanmoqda…' : createProduct.isPending ? 'Saqlanmoqda…' : 'Mahsulotni qo‘shish'}</button></form></div><div className="mt-6"><div className="flex items-center justify-between"><h3 className="text-sm font-extrabold">Mahsulotlar</h3><span className="text-xs text-[hsl(var(--muted-foreground))]">{products.data?.length || 0} ta mahsulot</span></div>{products.isLoading ? <div className="mt-3 skeleton h-20 rounded-2xl" /> : <div className="mt-3 grid gap-2">{products.data?.map(item => <AdminProductRow key={item.id} product={item} categories={categories.data ?? []} onDone={message => { setFeedback(message); invalidateCatalog(); }} onError={setFeedback} />)}</div>}</div></section></div>;
}

function WeeklyLeaderboard(props: { entries?: WeeklyLeaderboardEntry[]; loading: boolean }) {
  return <WeeklyLeaderboardContent {...props} />;
}

function WeeklyLeaderboardContent({ entries, loading }: { entries?: WeeklyLeaderboardEntry[]; loading: boolean }) {
  const topEntries = entries?.slice(0, 10);
  const { t } = useT(storeMessages);
  return <section data-testid="weekly-leaderboard" className="rounded-[26px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">{t('lbEyebrow')}</p><h2 className="display mt-1 text-xl font-extrabold">{t('lbTitle')}</h2><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{t('lbPrize')}</p><p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">{t('lbNameHint')}</p></div><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#fff0d4] text-[#a25e08]"><Trophy size={21} /></span></div>{loading ? <div className="mt-5 space-y-2"><div className="skeleton h-12 rounded-xl" /><div className="skeleton h-12 rounded-xl" /><div className="skeleton h-12 rounded-xl" /></div> : topEntries?.length ? <div className="mt-5 space-y-2">{topEntries.map(entry => <div key={`${entry.rank}-${entry.phone_masked}`} className={`flex items-center gap-3 rounded-2xl p-3 ${entry.is_winner ? 'bg-[#fff6dc]' : 'bg-[hsl(var(--muted)/.6)]'}`}><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-extrabold ${entry.is_winner ? 'bg-[#f4cc73] text-[#25483e]' : 'bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))]'}`}>{entry.rank}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-extrabold">{entry.customer_name}</p><p className="text-[11px] text-[hsl(var(--muted-foreground))]">{entry.phone_masked}{entry.is_winner && <span className="ml-2 font-bold text-[#a25e08]">· {entry.prize}</span>}</p></div><span data-testid={`text-leaderboard-orders-${entry.rank}`} className="display shrink-0 text-right text-sm font-extrabold">{t('lbOrderCount', { n: entry.order_count })}</span></div>)}</div> : <div className="mt-5 rounded-2xl bg-[hsl(var(--muted)/.6)] p-4 text-sm text-[hsl(var(--muted-foreground))]">{t('lbEmpty')}</div>}</section>;
}
function Metrics({ metrics }: { metrics: AdminDashboard }) { const values = [{ label: 'Bugungi buyurtma', value: metrics.today_orders, icon: ShoppingBag, tone: 'bg-[#e8efdc]' }, { label: 'Yangi navbat', value: metrics.new_orders, icon: Zap, tone: 'bg-[#fff0d4]' }, { label: 'Bugungi tushum (yetkazilgan)', value: money(metrics.today_revenue), icon: BarChart3, tone: 'bg-[#dceee9]' }, { label: 'Mijozlar', value: metrics.customer_count, icon: UserRound, tone: 'bg-[#f7e4dc]' }]; return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{values.map((metric, i) => <div key={metric.label} className={`animate-rise delay-${i + 1} rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 sm:p-5`}><div className="flex items-start justify-between gap-2"><span className={`flex h-9 w-9 items-center justify-center rounded-xl ${metric.tone} text-[hsl(var(--primary))]`}><metric.icon size={17} /></span><span className="mono text-[9px] text-[hsl(var(--muted-foreground))]">LIVE</span></div><p data-testid={`text-metric-${i}`} className="display mt-5 text-2xl font-extrabold sm:text-3xl">{metric.value}</p><p className="mt-1 text-xs font-semibold text-[hsl(var(--muted-foreground))]">{metric.label}</p></div>)}</div>; }
function AdminOrderRow({ order, onStatus, pending }: { order: Order; onStatus: (id: number, status: OrderStatus) => void; pending: boolean }) { const next: Partial<Record<OrderStatus, OrderStatus>> = { new: 'preparing', preparing: 'courier', courier: 'delivered' }; const cancellable = order.status !== 'delivered' && order.status !== 'cancelled'; const cancel = () => { if (window.confirm(`#${order.order_number} bekor qilinsinmi? Mahsulotlar omborga qaytariladi.`)) onStatus(order.id, 'cancelled'); }; return <div data-testid={`row-admin-order-${order.id}`} className="flex flex-col gap-3 rounded-2xl border border-[hsl(var(--border))] p-3.5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[hsl(var(--muted))] text-[hsl(var(--primary))]"><Package size={17} /></span><div><p className="text-sm font-extrabold">#{order.order_number} <span className="font-normal text-[hsl(var(--muted-foreground))]">· {order.customer_name}</span>{telegramLabel(order) && <span data-testid={`text-order-telegram-${order.id}`} className="font-semibold text-[#136a93]"> · {telegramLabel(order)}</span>}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{order.items.length} mahsulot · {money(order.total)}{order.scheduled_for && <span data-testid={`badge-admin-scheduled-${order.id}`} className="ml-1 inline-flex items-center gap-1 rounded-full bg-[#fff0d4] px-2 py-0.5 text-[10px] font-bold text-[#a25e08]">⏰ {deliveryLabel(new Date(order.scheduled_for))}</span>}</p>{order.status_changed_by && <p data-testid={`text-order-changed-by-${order.id}`} className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">{statusLabel[order.status]}: {order.status_changed_by}{order.status_changed_at ? ` · ${date(order.status_changed_at)}` : ''}</p>}<ul data-testid={`list-admin-order-items-${order.id}`} className="mt-2 space-y-0.5 text-xs">{order.items.map((line, index) => { const part = orderLineParts(line); return <li key={`${line.product_id}-${index}`} className="flex flex-wrap gap-x-1.5"><span className="font-semibold">{part.name}</span><span className="font-extrabold text-[hsl(var(--primary))]">{part.quantity}</span><span className="text-[hsl(var(--muted-foreground))]">= {part.total}</span></li>; })}</ul></div></div><div className="flex items-center justify-between gap-3 sm:justify-end"><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${statusTone[order.status]}`}>{statusLabel[order.status]}</span>{next[order.status] && <button aria-label={`${order.order_number} statusini ${statusLabel[next[order.status] as string]} qilish`} data-testid={`button-advance-order-${order.id}`} disabled={pending} onClick={() => onStatus(order.id, next[order.status] as OrderStatus)} className="tap flex items-center gap-1 rounded-full bg-[hsl(var(--primary))] px-3 py-1.5 text-[10px] font-bold text-white disabled:opacity-50">{pending ? <LoaderCircle size={12} className="animate-spin" /> : <ChevronRight size={13} />} {statusLabel[next[order.status] as string]}</button>}{cancellable && <button type="button" data-testid={`button-cancel-order-${order.id}`} disabled={pending} onClick={cancel} className="rounded-full border border-[#e6b2a8] px-3 py-1.5 text-[10px] font-bold text-[#9d493e] disabled:opacity-50">Bekor qilish</button>}</div></div>; }
// Both order lists advance and cancel orders the same way. A refusal (another
// admin already moved it) is shown and the list refreshed to the real state;
// cancelling returns stock, so the catalog is refreshed too.
function useChangeOrderStatus() {
  const update = useUpdateAdminOrderStatus();
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: getListAdminOrdersQueryKey() });
    qc.invalidateQueries({ queryKey: getGetAdminDashboardQueryKey() });
    qc.invalidateQueries({ queryKey: getListAdminProductsQueryKey() });
    qc.invalidateQueries({ queryKey: getListProductsQueryKey() });
  };
  const run = (id: number, status: OrderStatus) => update.mutate({ id, data: { status } }, {
    onSuccess: refresh,
    onError: err => { window.alert(apiErrorMessage(err, 'Holatni o‘zgartirib bo‘lmadi.')); refresh(); },
  });
  return { run, pending: update.isPending };
}
function AdminSkeleton() { return <><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[1,2,3,4].map(i => <div key={i} className="skeleton h-32 rounded-[22px]" />)}</div><div className="mt-8 skeleton h-[430px] rounded-[26px]" /></>; }

function AdminOrders() {
  const orders = useListAdminOrders(undefined, { query: { queryKey: getListAdminOrdersQueryKey() } });
  const changeStatus = useChangeOrderStatus();
  return <div className="container-wide py-7 sm:py-10"><div className="mb-8"><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Operator workspace</p><h1 className="display mt-2 text-4xl font-extrabold sm:text-5xl">Barcha buyurtmalar</h1></div>{orders.isLoading ? <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="skeleton h-20 rounded-2xl" />)}</div> : orders.isError ? <QueryError retry={() => orders.refetch()} /> : orders.data?.length ? <div className="space-y-3">{orders.data.map(order => <AdminOrderRow key={order.id} order={order} onStatus={changeStatus.run} pending={changeStatus.pending} />)}</div> : <EmptyState title="Buyurtmalar yo‘q" text="Hozircha tizimda buyurtmalar mavjud emas." />}</div>;
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
            <Route path="/admin/chat" component={AdminChat} />
            <Route path="/admin/customers" component={AdminCustomers} />
            <Route path="/admin/admins" component={AdminAccounts} />
            <Route path="/admin/profile" component={AdminProfile} />
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
