import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ShoppingBasket, X } from 'lucide-react';
import { imageSources, sizedImage } from '@/lib/images';

// The picture of an ordered product, small beside its line in the admin's
// order list, so the admin sees what was ordered at a glance; pressed, it
// opens large. The picture is the one the product had when it was ordered.
export function OrderItemPhoto({ url, name }: { url?: string | null; name: string }) {
  // The address that failed to load, so a new one gets its own chance at once.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [bigFailed, setBigFailed] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const frame = 'flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]';
  if (!url || failedUrl === url) {
    return <span className={frame} aria-hidden><ShoppingBasket size={15} className="text-[hsl(var(--muted-foreground))]" /></span>;
  }
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className={`${frame} tap`} aria-label={`${name} — rasmni kattalashtirish`} data-testid="button-order-item-photo">
          <img src={sizedImage(url, 120)} alt="" loading="lazy" onError={() => setFailedUrl(url)} className="h-full w-full object-cover" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-[hsl(var(--foreground)/.6)] backdrop-blur-sm" />
        {/* No taller than the screen, so the close button stays in view on a
            phone held sideways; the picture takes what is left. */}
        <Dialog.Content
          aria-describedby={undefined}
          data-testid="dialog-order-item-photo"
          className="fixed left-1/2 top-1/2 z-[70] flex max-h-[calc(100dvh-24px)] w-[calc(100%-24px)] max-w-[560px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[22px] bg-[hsl(var(--card))] shadow-[0_24px_60px_rgba(20,40,34,.3)] outline-none"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
            <Dialog.Title className="truncate text-sm font-extrabold">{name}</Dialog.Title>
            <Dialog.Close className="rounded-full p-1.5 hover:bg-[hsl(var(--muted))]" aria-label="Yopish"><X size={18} /></Dialog.Close>
          </div>
          {bigFailed === url ? (
            <div className="flex min-h-[200px] flex-1 items-center justify-center bg-[hsl(var(--muted))]"><ShoppingBasket size={36} strokeWidth={1.3} className="text-[hsl(var(--muted-foreground))]" /></div>
          ) : (
            <img
              {...imageSources(url, [600, 1200])}
              sizes="min(560px, calc(100vw - 24px))"
              alt={name}
              onError={() => setBigFailed(url)}
              className="min-h-[200px] w-full min-w-0 flex-1 bg-[hsl(var(--muted))] object-contain"
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
