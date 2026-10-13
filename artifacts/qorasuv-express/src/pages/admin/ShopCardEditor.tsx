import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  getListAdminShopsQueryKey,
  getListShopsQueryKey,
  useUpdateShopCard,
} from '@workspace/api-client-react';
import { ArrowLeft, LoaderCircle } from 'lucide-react';
import { apiErrorMessage } from './AdminLogin';
import { cleanCard } from './AdminShops';
import { RichHtmlField, RichHtmlView, type MultiLang } from '@/components/rich-text';
import { htmlEquals } from '@/lib/rich-html';
import { useAdminShop, useUnsavedWork } from '@/lib/admin-shop';

// How a shop shows itself on the storefront: a card made in the editor, shown
// big on the shop's own page and small next to the other shops. Q express's
// admins may edit any shop's card; another shop's admins their own.
export function ShopCardEditor() {
  const qc = useQueryClient();
  const { admin, shops, acting, platformAdmin } = useAdminShop();
  const requested = Number(new URLSearchParams(window.location.search).get('shop'));
  const pinned = platformAdmin && requested ? shops.find(item => item.id === requested) : undefined;
  const shop = pinned ?? acting;
  const update = useUpdateShopCard();
  const [card, setCard] = useState<MultiLang>({});
  const [saved, setSaved] = useState<MultiLang>({});
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  // Loads the shop's card once it is known, and again for another shop.
  useEffect(() => {
    if (!shop) return;
    setCard(shop.card ?? {});
    setSaved(shop.card ?? {});
    setMessage(null);
    // Only a different shop reloads; a refetch of the same one keeps the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop?.id]);

  const changed = (['uz', 'ru', 'en'] as const).some(lang => !htmlEquals(card[lang] ?? '', saved[lang] ?? ''));
  // Opened for one shop (?shop=), the editor stays on it whatever the shop
  // switcher says, so switching loses nothing and needs no warning.
  useUnsavedWork('shop-card', changed && !pinned);

  if (!admin || !shop) return <div className="container-wide py-10"><div className="skeleton h-64 rounded-[26px]" /></div>;

  const save = () => {
    const clean = cleanCard(card);
    update.mutate({ id: shop.id, data: { card: clean } }, {
      onSuccess: next => {
        setSaved(next.card ?? {});
        setCard(next.card ?? {});
        setMessage({ text: 'Ko‘rinish saqlandi.', isError: false });
        qc.invalidateQueries({ queryKey: getListAdminShopsQueryKey() });
        qc.invalidateQueries({ queryKey: getListShopsQueryKey() });
      },
      onError: err => setMessage({ text: apiErrorMessage(err, 'Saqlab bo‘lmadi.'), isError: true }),
    });
  };

  return (
    <div className="container-wide py-7 sm:py-10">
      {platformAdmin && <Link href="/admin/shops" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-[hsl(var(--muted-foreground))]"><ArrowLeft size={16} /> Do‘konlar</Link>}
      <div className="mb-6">
        <p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Do‘kon ko‘rinishi</p>
        <h1 className="display mt-2 text-4xl font-extrabold sm:text-5xl">{shop.name}</h1>
        <p className="mt-2 max-w-[640px] text-sm text-[hsl(var(--muted-foreground))]">Mijozlar do‘kon sahifasining tepasida shu kartochkani katta, boshqa do‘konlar yonida esa kichik holda ko‘radi. Matn, rang va fonni o‘zingiz tanlaysiz; har bir til uchun alohida yozish mumkin. Bo‘sh tilda o‘zbekchasi, u ham bo‘sh bo‘lsa yozilgan boshqa tildagisi ko‘rinadi.</p>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <section className="rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 sm:p-5">
          <RichHtmlField name="Do‘kon ko‘rinishi" value={card} original={saved} onChange={setCard} />
          {message && <p role="status" className={`mt-4 rounded-xl p-3 text-sm font-semibold ${message.isError ? 'bg-[#fdf0ed] text-[#9d493e]' : 'bg-[#e8efdc] text-[hsl(var(--primary))]'}`}>{message.text}</p>}
          <button type="button" onClick={save} disabled={!changed || update.isPending} data-testid="button-save-shop-card" className="tap mt-4 flex h-11 items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-6 text-xs font-extrabold text-white disabled:opacity-50">
            {update.isPending && <LoaderCircle size={14} className="animate-spin" />} Saqlash
          </button>
        </section>
        <aside className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-extrabold">Do‘kon sahifasida</p>
            <div className="overflow-hidden rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card))]"><RichHtmlView value={card} bare /></div>
            <p data-testid="text-card-scales" className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">Matn kartochka kengligiga qarab o‘zgaradi: telefonda shu ko‘rinishda, kompyuterda kartochka keng bo‘lgani uchun hammasi bir xil nisbatda kattaroq.</p>
          </div>
          <div>
            <p className="mb-2 text-xs font-extrabold">Boshqa do‘konlar yonida</p>
            <div className="relative h-[112px] w-[188px] overflow-hidden rounded-[20px] border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
              <div aria-hidden inert className="pointer-events-none absolute left-0 top-0 w-[300%] origin-top-left scale-[.3333]"><RichHtmlView value={card} bare /></div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
