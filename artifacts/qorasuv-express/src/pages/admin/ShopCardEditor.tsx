import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  getListAdminShopsQueryKey,
  getListShopsQueryKey,
  useUpdateShopCard,
  type AdminShop,
  type ShopCardInput,
} from '@workspace/api-client-react';
import { ArrowLeft, LoaderCircle } from 'lucide-react';
import { apiErrorMessage } from './AdminLogin';
import { asInput, cleanCard, ShopPictureFields } from './AdminShops';
import { RichHtmlField, type MultiLang } from '@/components/rich-text';
import { ShopBanner, ShopTileFace } from '@/components/ShopCards';
import { htmlEquals } from '@/lib/rich-html';
import { usePictureUploads } from '@/lib/use-picture-uploads';
import { useAdminShop, useUnsavedWork } from '@/lib/admin-shop';

// A picked file's address for a preview, released when it changes.
function useObjectUrl(file: File | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return setUrl(null);
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

// How a shop shows itself on the storefront: a card made in the editor over
// its background picture, shown big on the shop's own page and small next to
// the other shops, and its icon. Q express's admins may edit any shop's card;
// another shop's admins their own.
export function ShopCardEditor() {
  const qc = useQueryClient();
  const { admin, shops, acting, platformAdmin } = useAdminShop();
  const requested = Number(new URLSearchParams(window.location.search).get('shop'));
  const pinned = platformAdmin && requested ? shops.find(item => item.id === requested) : undefined;
  const shop = pinned ?? acting;
  const update = useUpdateShopCard();
  const [card, setCard] = useState<MultiLang>({});
  const [saved, setSaved] = useState<MultiLang>({});
  // The shop whose card the state above holds. The editor opens only once it
  // is this shop: opened on the empty first state, it would report that empty
  // text as loaded after the real card arrived, and replace the card with it.
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  // New pictures picked, and the saved ones taken off; both wait for Saqlash.
  const [background, setBackground] = useState<File | null>(null);
  const [icon, setIcon] = useState<File | null>(null);
  const [backgroundRemoved, setBackgroundRemoved] = useState(false);
  const [iconRemoved, setIconRemoved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploads = usePictureUploads();
  useEffect(() => uploads.keepOnly([background, icon]), [background, icon, uploads]);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  // The form as it is now, for a save that answers after more was typed.
  const latest = useRef({ card, background, icon, backgroundRemoved, iconRemoved });
  latest.current = { card, background, icon, backgroundRemoved, iconRemoved };
  // The shop on screen now, for a save that answers after a switch.
  const onScreen = useRef<number | undefined>(undefined);
  onScreen.current = shop?.id;
  const backgroundPreview = useObjectUrl(background);
  const iconPreview = useObjectUrl(icon);

  const resetPictures = () => {
    setBackground(null);
    setIcon(null);
    setBackgroundRemoved(false);
    setIconRemoved(false);
  };

  // Loads the shop's card once it is known, and again for another shop.
  useEffect(() => {
    if (!shop) return;
    setCard(shop.card ?? {});
    setSaved(shop.card ?? {});
    setLoadedFor(shop.id);
    resetPictures();
    setMessage(null);
    // Only a different shop reloads; a refetch of the same one keeps the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop?.id]);

  const picturesChanged = Boolean(background || icon || backgroundRemoved || iconRemoved);
  const changed = picturesChanged || (['uz', 'ru', 'en'] as const).some(lang => !htmlEquals(card[lang] ?? '', saved[lang] ?? ''));
  // Opened for one shop (?shop=), the editor stays on it whatever the shop
  // switcher says, so switching loses nothing and needs no warning.
  useUnsavedWork('shop-card', changed && !pinned);

  if (!admin || !shop) return <div className="container-wide py-10"><div className="skeleton h-64 rounded-[26px]" /></div>;

  const currentBackground = backgroundRemoved ? null : shop.background_url;
  const currentIcon = iconRemoved ? null : shop.icon_url;
  const busy = uploading || update.isPending;

  const save = async () => {
    setMessage(null);
    // What this save sends; whatever is typed or picked while it runs stays
    // in the form afterwards rather than being overwritten by the answer.
    const sent = { card, background, icon, backgroundRemoved, iconRemoved };
    const data: ShopCardInput = { card: cleanCard(card) };
    // From the upload to the save's answer no picture of this form is deleted.
    const end = uploads.begin();

    // The pictures go up first, so the card never points at a file that
    // failed to arrive.
    if (background || icon) {
      setUploading(true);
      try {
        if (background) data.background = asInput(await uploads.upload(background));
        if (icon) data.icon = asInput(await uploads.upload(icon));
      } catch (failure) {
        setUploading(false);
        end();
        return setMessage({ text: failure instanceof Error ? failure.message : 'Rasm yuklanmadi.', isError: true });
      }
      setUploading(false);
    }
    if (!background && backgroundRemoved) data.background = null;
    if (!icon && iconRemoved) data.icon = null;
    update.mutate({ id: shop.id, data }, {
      onSuccess: next => {
        uploads.saved();
        // The saved shop at once in the list, so its new pictures show and a
        // remove pressed right away reads them, before the list is refetched.
        qc.setQueryData<AdminShop[]>(getListAdminShopsQueryKey(), list => list?.map(item => item.id === next.id ? next : item));
        // Another shop opened while this was saving keeps its own draft.
        if (onScreen.current === next.id) {
          const now = latest.current;
          setSaved(next.card ?? {});
          if (now.card === sent.card) setCard(next.card ?? {});
          if (now.background === sent.background) setBackground(null);
          if (now.icon === sent.icon) setIcon(null);
          if (now.backgroundRemoved === sent.backgroundRemoved) setBackgroundRemoved(false);
          if (now.iconRemoved === sent.iconRemoved) setIconRemoved(false);
          setMessage({ text: 'Ko‘rinish saqlandi.', isError: false });
        }
        qc.invalidateQueries({ queryKey: getListAdminShopsQueryKey() });
        qc.invalidateQueries({ queryKey: getListShopsQueryKey() });
      },
      onError: err => setMessage({ text: apiErrorMessage(err, 'Saqlab bo‘lmadi.'), isError: true }),
      onSettled: end,
    });
  };

  const previewBackground = backgroundPreview ?? currentBackground;
  const previewShop = { ...shop, card, background_url: previewBackground, icon_url: iconPreview ?? currentIcon };
  return (
    <div className="container-wide py-7 sm:py-10">
      {platformAdmin && <Link href="/admin/shops" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-[hsl(var(--muted-foreground))]"><ArrowLeft size={16} /> Do‘konlar</Link>}
      <div className="mb-6">
        <p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Do‘kon ko‘rinishi</p>
        <h1 className="display mt-2 text-4xl font-extrabold sm:text-5xl">{shop.name}</h1>
        <p className="mt-2 max-w-[640px] text-sm text-[hsl(var(--muted-foreground))]">Mijozlar do‘kon sahifasining tepasida shu kartochkani katta, boshqa do‘konlar yonida esa kichik holda ko‘radi. Matn, rang va fonni o‘zingiz tanlaysiz; har bir til uchun alohida yozish mumkin. Bo‘sh tilda o‘zbekchasi, u ham bo‘sh bo‘lsa yozilgan boshqa tildagisi ko‘rinadi.</p>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <section className="space-y-4 rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 sm:p-5">
          <ShopPictureFields
            background={background}
            icon={icon}
            onBackground={file => { setBackground(file); if (file) setBackgroundRemoved(false); }}
            onIcon={file => { setIcon(file); if (file) setIconRemoved(false); }}
            currentBackground={currentBackground}
            currentIcon={currentIcon}
            onRemoveBackground={() => { setBackground(null); setBackgroundRemoved(Boolean(shop.background_url)); }}
            onRemoveIcon={() => { setIcon(null); setIconRemoved(Boolean(shop.icon_url)); }}
            disabled={busy}
            withIcon={!shop.is_platform}
          />
          {shop.is_platform ? (
            <p data-testid="text-platform-card" className="rounded-xl bg-[hsl(var(--muted)/.6)] p-3 text-[12px] text-[hsl(var(--muted-foreground))]">Q express bosh sahifasi o‘zining doimiy dizaynida qoladi. Boshqa do‘konlar sahifasida esa Q express doim o‘z belgisi va nomi bilan ko‘rinadi; bu yerda faqat o‘sha kichik kartochkaning fon rasmini tanlash mumkin. Yangi do‘kon kartochkasini «Do‘konlar» bo‘limida, o‘sha do‘kon yonidagi «Ko‘rinish» tugmasi orqali tahrirlang.</p>
          ) : loadedFor === shop.id
            ? <RichHtmlField key={shop.id} name="Do‘kon ko‘rinishi" value={card} original={saved} onChange={setCard} />
            : <div className="skeleton h-64 rounded-xl" />}
          {message && <p role="status" className={`rounded-xl p-3 text-sm font-semibold ${message.isError ? 'bg-[#fdf0ed] text-[#9d493e]' : 'bg-[#e8efdc] text-[hsl(var(--primary))]'}`}>{message.text}</p>}
          <button type="button" onClick={() => void save()} disabled={!changed || busy} data-testid="button-save-shop-card" className="tap flex h-11 items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-6 text-xs font-extrabold text-white disabled:opacity-50">
            {busy && <LoaderCircle size={14} className="animate-spin" />} {uploading ? 'Rasmlar yuklanmoqda…' : 'Saqlash'}
          </button>
        </section>
        <aside className="space-y-4">
          {!shop.is_platform && <div>
            <p className="mb-2 text-xs font-extrabold">Do‘kon sahifasida (telefon kengligida)</p>
            {/* As wide as the storefront's column, so it wraps as customers see it. */}
            <div data-testid="preview-shop-banner" className="w-[398px] max-w-full overflow-hidden rounded-[30px] border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
              <ShopBanner card={card} background={previewBackground} title={shop.name} />
            </div>
            <p data-testid="text-card-scales" className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">Fon rasmi bo‘lsa, kartochka 4:3 bo‘ladi va undagi butun matn oq rangda, rangli fonlarsiz chiqadi: har qanday rasm ustida o‘qilishi uchun. Matn ranglari va fon bo‘yoqlari faqat rasmsiz kartochkada ishlaydi. Matn ko‘p bo‘lsa, kartochka pastga cho‘ziladi.</p>
          </div>}
          <div>
            <p className="mb-2 text-xs font-extrabold">Boshqa do‘konlar yonida</p>
            <div className="relative h-[141px] w-[188px] overflow-hidden rounded-[20px] border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
              <ShopTileFace shop={previewShop} />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
