import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { ArrowRight, Store } from 'lucide-react';
import type { Shop } from '@workspace/api-client-react';
import { RichHtmlView, type MultiLang } from '@/components/rich-text';
import { imageSources, sizedImage } from '@/lib/images';
import { isBlankHtml } from '@/lib/rich-html';
import { shopHref, useShop } from '@/lib/shop';
import { useT } from '@/i18n';
import storeMessages from '@/i18n/messages/store';

// How a shop presents itself on the storefront: the card its admins made in
// the editor (text, fonts, colours), over the background picture they cropped
// to 4:3, shown big for the shop being visited and small for the others. A
// shop with no card yet shows its name.

export function hasCard(shop: Pick<Shop, 'card'>) {
  return Object.values(shop.card ?? {}).some(html => !isBlankHtml(html));
}

// The sizes a 4:3 background is sent in; the phone picks one for its screen.
const BACKGROUND_WIDTHS = [400, 800, 1200, 1600];
// How wide the banner is shown: the phone column (at most 430px) less its
// 16px margins.
const BANNER_SIZES = '(max-width: 430px) calc(100vw - 32px), 398px';

/**
 * The card itself, also the editor's preview. With a background picture it is
 * 4:3 like the frame the picture was cropped to (taller only when the text
 * needs it), the picture covers all of it, and the text turns white over a
 * soft shade so it reads on any photo.
 */
export function ShopBanner({ card, background, title, children }: {
  card?: MultiLang;
  /** A stored picture's URL, or a picked file's preview. */
  background?: string | null;
  /** Shown when the card is blank. */
  title: string;
  /** Laid along the bottom, over the picture (the catalog link). */
  children?: ReactNode;
}) {
  const filled = Object.values(card ?? {}).some(html => !isBlankHtml(html));
  return (
    <div data-testid="shop-banner" className={`relative isolate grid overflow-hidden ${background ? 'shop-banner-photo bg-[#1d2420]' : ''}`}>
      {background && <>
        <img {...imageSources(background, BACKGROUND_WIDTHS)} sizes={BANNER_SIZES} alt="" className="absolute inset-0 -z-10 h-full w-full object-cover" />
        <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(0,0,0,.42),rgba(0,0,0,.12)_45%,rgba(0,0,0,.5))]" />
        {/* Holds the card at 4:3; the content beside it may make it taller. */}
        <div aria-hidden className="aspect-[4/3] [grid-area:1/1]" />
      </>}
      <div className="flex flex-col [grid-area:1/1]">
        <div className="flex-1">
          {filled ? (
            <RichHtmlView value={card} bare />
          ) : (
            <div className={`px-6 py-10 ${background ? 'text-white' : 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'}`}>
              <h1 className="display text-[2.1rem] font-extrabold leading-none [text-shadow:0_2px_10px_rgba(0,0,0,.25)]">{title}</h1>
            </div>
          )}
        </div>
        {children && (
          <div className={`flex justify-end p-3 ${background ? '' : 'border-t border-[hsl(var(--border))]'}`}>{children}</div>
        )}
      </div>
    </div>
  );
}

// The shop's square icon, or a shop glyph when it has none.
export function ShopIcon({ url, className = 'h-10 w-10 rounded-2xl' }: { url?: string | null; className?: string }) {
  if (url) return <img src={sizedImage(url, 128)} srcSet={`${sizedImage(url, 128)} 1x, ${sizedImage(url, 256)} 2x`} alt="" className={`shrink-0 object-cover ${className}`} />;
  return <span className={`flex shrink-0 items-center justify-center bg-[#e8efdc] text-[hsl(var(--primary))] ${className}`}><Store size={19} /></span>;
}

// The visited shop's own banner, in place of Q express's hero.
export function ShopHero({ shop }: { shop: Shop }) {
  const { t, script } = useT(storeMessages);
  return (
    <section data-testid={`hero-shop-${shop.slug}`} className="overflow-hidden rounded-[30px] border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
      <ShopBanner card={shop.card} background={shop.background_url} title={script(shop.name)}>
        <Link href="/catalog" data-testid="link-shop-hero-catalog" className="tap inline-flex items-center gap-2 rounded-full bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-extrabold text-white">
          {t('heroCta')} <ArrowRight size={16} />
        </Link>
      </ShopBanner>
    </section>
  );
}

// The other shops, small, next to the one being visited. Q express is among
// them while another shop is visited.
export function ShopStrip() {
  const { shop: current, shops } = useShop();
  const { t } = useT(storeMessages);
  const others = shops.filter(shop => shop.id !== current?.id);
  if (others.length === 0) return null;
  return (
    <section data-testid="strip-other-shops">
      <p className="mono mb-3 text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">{t('otherShops')}</p>
      <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none]">
        {others.map(shop => <ShopTile key={shop.id} shop={shop} />)}
      </div>
    </section>
  );
}

/** The small card, 188×141 (4:3, like the background); also the editor's preview. */
export function ShopTileFace({ shop }: { shop: Pick<Shop, 'name' | 'card' | 'is_platform' | 'background_url' | 'icon_url'> }) {
  const { script } = useT(storeMessages);
  // Q express is always shown as itself: its home page keeps its own design,
  // so a card written for it could only make its tile read as another shop.
  if (shop.is_platform) {
    return shop.background_url ? (
      <div className="relative h-full w-full">
        <img {...imageSources(shop.background_url, [400, 800])} sizes="188px" alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,.62))] px-3 pb-2.5 pt-6">
          <img src="/brand/icon.svg" alt="" className="h-7 w-7" />
          <span className="display text-[16px] font-extrabold tracking-[-.04em] text-white [text-shadow:0_1px_4px_rgba(0,0,0,.4)]">Q express</span>
        </div>
      </div>
    ) : (
      <div className="flex h-full items-center gap-2.5 bg-[hsl(var(--primary))] px-4">
        <img src="/brand/icon.svg" alt="" className="h-9 w-9" />
        <span className="display text-[18px] font-extrabold tracking-[-.04em] text-white">Q express</span>
      </div>
    );
  }
  if (shop.background_url) {
    // The picture, and the shop's icon and name over its darkened foot.
    return (
      <div className="relative h-full w-full">
        <img {...imageSources(shop.background_url, [400, 800])} sizes="188px" alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,.62))] px-3 pb-2.5 pt-6">
          {shop.icon_url && <ShopIcon url={shop.icon_url} className="h-7 w-7 rounded-lg border border-white/60" />}
          <span className="display truncate text-[14px] font-extrabold leading-tight text-white [text-shadow:0_1px_4px_rgba(0,0,0,.4)]">{script(shop.name)}</span>
        </div>
      </div>
    );
  }
  if (hasCard(shop)) {
    // The full card drawn at a third of its size, so it reads as the same
    // design; it cannot be clicked into, the tile is the link.
    return (
      // At the banner's own width (the 398px column), scaled down to the tile,
      // so its lines wrap where they do on the shop's page.
      <div aria-hidden inert className="pointer-events-none absolute left-0 top-0 w-[398px] origin-top-left scale-[.4724]">
        <RichHtmlView value={shop.card} bare />
      </div>
    );
  }
  return (
    <div className="flex h-full items-center gap-2.5 px-4">
      <ShopIcon url={shop.icon_url} />
      <span className="display text-[16px] font-extrabold leading-tight">{script(shop.name)}</span>
    </div>
  );
}

function ShopTile({ shop }: { shop: Shop }) {
  return (
    // The tile is drawn underneath and the link laid over it, so the card's own
    // links are never inside the tile's link nor reachable with Tab (inert).
    // A press starts loading the shop's big picture, so it is often there by
    // the time the shop opens.
    <div onPointerDown={() => preloadBackground(shop.background_url)} className="group relative h-[141px] w-[188px] shrink-0 overflow-hidden rounded-[20px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] transition hover:-translate-y-1 hover:border-[hsl(var(--primary)/.35)] hover:shadow-[var(--shadow-sm)]">
      <ShopTileFace shop={shop} />
      <Link href={shopHref(shop)} data-testid={`link-shop-${shop.slug}`} aria-label={shop.name} className="absolute inset-0 rounded-[20px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--primary))]" />
    </div>
  );
}

const preloaded = new Set<string>();

// Fetches the copy of the banner this screen will ask for, into the cache.
function preloadBackground(url?: string | null) {
  if (!url || preloaded.has(url)) return;
  preloaded.add(url);
  const image = new Image();
  image.sizes = BANNER_SIZES;
  const sources = imageSources(url, BACKGROUND_WIDTHS);
  if (sources.srcSet) image.srcset = sources.srcSet;
  image.src = sources.src;
}
