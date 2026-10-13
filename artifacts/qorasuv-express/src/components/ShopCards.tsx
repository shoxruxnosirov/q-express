import { Link } from 'wouter';
import { ArrowRight, Store } from 'lucide-react';
import type { Shop } from '@workspace/api-client-react';
import { RichHtmlView } from '@/components/rich-text';
import { isBlankHtml } from '@/lib/rich-html';
import { shopHref, useShop } from '@/lib/shop';
import { useT } from '@/i18n';
import storeMessages from '@/i18n/messages/store';

// How a shop presents itself on the storefront: the card its admins made in
// the editor (text, fonts, colours, background), shown big for the shop being
// visited and small for the others. A shop with no card yet shows its name.

export function hasCard(shop: Pick<Shop, 'card'>) {
  return Object.values(shop.card ?? {}).some(html => !isBlankHtml(html));
}

// The visited shop's own banner, in place of Q express's hero.
export function ShopHero({ shop }: { shop: Shop }) {
  const { t, script } = useT(storeMessages);
  return (
    <section data-testid={`hero-shop-${shop.slug}`} className="overflow-hidden rounded-[30px] border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
      {hasCard(shop) ? (
        <RichHtmlView value={shop.card} bare />
      ) : (
        <div className="bg-[hsl(var(--primary))] px-6 py-10 text-[hsl(var(--primary-foreground))] sm:px-10 sm:py-12">
          <h1 className="display text-[clamp(2.1rem,6vw,4rem)] font-extrabold leading-none">{script(shop.name)}</h1>
        </div>
      )}
      <div className="flex justify-end border-t border-[hsl(var(--border))] p-3">
        <Link href="/catalog" data-testid="link-shop-hero-catalog" className="tap inline-flex items-center gap-2 rounded-full bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-extrabold text-white">
          {t('heroCta')} <ArrowRight size={16} />
        </Link>
      </div>
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

function ShopTile({ shop }: { shop: Shop }) {
  const { script } = useT(storeMessages);
  return (
    // The tile is drawn underneath and the link laid over it, so the card's own
    // links are never inside the tile's link nor reachable with Tab (inert).
    <div className="group relative h-[112px] w-[188px] shrink-0 overflow-hidden rounded-[20px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] transition hover:-translate-y-1 hover:border-[hsl(var(--primary)/.35)] hover:shadow-[var(--shadow-sm)]">
      {hasCard(shop) ? (
        // The full card drawn at a third of its size, so it reads as the same
        // design; it cannot be clicked into, the tile is the link.
        <div aria-hidden inert className="pointer-events-none absolute left-0 top-0 w-[300%] origin-top-left scale-[.3333]">
          <RichHtmlView value={shop.card} bare />
        </div>
      ) : shop.is_platform ? (
        <div className="flex h-full items-center gap-2.5 bg-[hsl(var(--primary))] px-4">
          <img src="/brand/icon.svg" alt="" className="h-9 w-9" />
          <span className="display text-[18px] font-extrabold tracking-[-.04em] text-white">Q express</span>
        </div>
      ) : (
        <div className="flex h-full items-center gap-2.5 px-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#e8efdc] text-[hsl(var(--primary))]"><Store size={19} /></span>
          <span className="display text-[16px] font-extrabold leading-tight">{script(shop.name)}</span>
        </div>
      )}
      <Link href={shopHref(shop)} data-testid={`link-shop-${shop.slug}`} aria-label={shop.name} className="absolute inset-0 rounded-[20px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--primary))]" />
    </div>
  );
}
