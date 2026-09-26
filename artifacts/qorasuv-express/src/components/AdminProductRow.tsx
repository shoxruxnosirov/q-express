import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, ImagePlus, LoaderCircle, PackageX, Pencil, ShoppingBasket, Sparkles, Star, Trash2, X } from 'lucide-react';
import {
  createAdminUploadTicket,
  useDeleteAdminProduct,
  useUpdateAdminProduct,
  type AdminProduct,
  type Category,
} from '@workspace/api-client-react';

const money = (value: number) => `${Math.round(value).toLocaleString('ru-RU')} so'm`;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const UNITS = ['dona', 'kg', 'litr', 'qadoq'] as const;
type Unit = (typeof UNITS)[number];

export type UploadedImage = { url: string; publicId: string };

// The signature authorises one upload and expires within a minute, so it is
// fetched per file rather than cached. The bytes go straight from the browser
// to Cloudinary and never pass through our own server, which sleeps when idle.
export async function uploadProductImage(file: File): Promise<UploadedImage> {
  if (!file.type.startsWith('image/')) throw new Error('Faqat rasm fayli yuklanadi.');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Rasm hajmi 10 MB dan oshmasligi kerak.');

  const ticket = await createAdminUploadTicket();
  const form = new FormData();
  form.append('file', file);
  form.append('api_key', ticket.api_key);
  form.append('timestamp', String(ticket.timestamp));
  form.append('folder', ticket.folder);
  form.append('signature', ticket.signature);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${ticket.cloud_name}/image/upload`, {
    method: 'POST',
    body: form,
  });
  if (!response.ok) throw new Error('Rasm yuklanmadi. Qaytadan urinib ko‘ring.');
  const payload = (await response.json()) as { secure_url?: string; public_id?: string };
  if (!payload.secure_url || !payload.public_id) throw new Error('Rasm yuklandi, lekin manzili qaytmadi.');
  return { url: payload.secure_url, publicId: payload.public_id };
}

// The picked file is held here and only uploaded when the form is saved, so
// abandoning an edit leaves nothing behind in the image store.
export function AdminImageField({
  currentUrl,
  file,
  onPick,
  disabled = false,
}: {
  currentUrl?: string;
  file: File | null;
  onPick: (file: File | null) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | undefined>(currentUrl);

  useEffect(() => {
    if (!file) {
      setPreview(currentUrl);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, currentUrl]);

  return (
    <div className="flex items-center gap-3">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        {preview
          ? <img src={preview} alt="" className="h-full w-full object-cover" />
          : <ShoppingBasket size={20} strokeWidth={1.3} className="text-[hsl(var(--muted-foreground))]" />}
      </div>
      <div className="min-w-0 flex-1">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          disabled={disabled}
          onChange={event => onPick(event.target.files?.[0] ?? null)}
          className="hidden"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="tap flex items-center gap-1.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs font-bold transition hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary))] disabled:opacity-50"
        >
          <ImagePlus size={14} /> {preview ? 'Rasmni almashtirish' : 'Rasm tanlash'}
        </button>
        {file && (
          <p className="mt-1 truncate text-[11px] text-[hsl(var(--muted-foreground))]">
            {file.name} · saqlanganda yuklanadi
          </p>
        )}
      </div>
    </div>
  );
}

export function FlagToggle({
  on,
  label,
  icon: Icon,
  onToggle,
  testId,
}: {
  on: boolean;
  label: string;
  icon: typeof Star;
  onToggle: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-testid={testId}
      onClick={onToggle}
      className={`tap flex items-center gap-1.5 rounded-full border px-3 py-2 text-[11px] font-bold transition ${
        on
          ? 'border-transparent bg-[hsl(var(--primary))] text-white'
          : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))]'
      }`}
    >
      <Icon size={13} /> {label}
    </button>
  );
}

const fieldClass =
  'h-11 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm outline-none focus:border-[hsl(var(--primary))]';

export function AdminProductRow({
  product,
  categories,
  onDone,
  onError,
}: {
  product: AdminProduct;
  categories: Category[];
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const updateProduct = useUpdateAdminProduct();
  const deleteProduct = useDeleteAdminProduct();
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const draftFrom = (current: AdminProduct) => ({
    category_id: String(current.category_id),
    name: current.name,
    description: current.description,
    price: String(current.price),
    old_price: current.old_price == null ? '' : String(current.old_price),
    unit: current.unit as Unit,
    stock: String(current.stock),
    is_popular: current.is_popular,
    is_new: current.is_new,
    active: current.active,
  });
  const [draft, setDraft] = useState(() => draftFrom(product));
  // The form is refilled from the product each time it opens. Otherwise a
  // quick "Tugab qoldi", or an order that sold some, would leave the form
  // holding the old stock, and saving it would quietly put that stock back.
  const openEditor = () => {
    setDraft(draftFrom(product));
    setOpen(true);
  };
  const soldOut = product.stock <= 0;

  const markSoldOut = () => {
    if (!window.confirm(`"${product.name}" tugab qoldimi? Qoldiq 0 bo‘ladi va mijozlarga "Tugagan" deb ko‘rinadi.`)) return;
    updateProduct.mutate(
      { id: product.id, data: { stock: 0 } },
      {
        onSuccess: () => onDone(`"${product.name}" tugagan deb belgilandi.`),
        onError: () => onError('Qoldiqni o‘zgartirib bo‘lmadi.'),
      },
    );
  };

  const busy = uploading || updateProduct.isPending || deleteProduct.isPending;

  const close = () => {
    setOpen(false);
    setFile(null);
    setConfirmingDelete(false);
  };

  const save = async () => {
    const isContinuous = draft.unit === 'kg' || draft.unit === 'litr';
    const stock = parseFloat(draft.stock);
    const price = Number(draft.price);
    if (!draft.name.trim() || !draft.description.trim()) return onError('Nom va tavsif bo‘sh bo‘lmasin.');
    if (!Number.isFinite(price) || price <= 0) return onError('Narx noto‘g‘ri kiritildi.');
    if (!Number.isFinite(stock) || stock < 0 || (!isContinuous && !Number.isInteger(stock))) {
      return onError('Qoldiq noto‘g‘ri kiritildi.');
    }

    // Upload before the mutation so a failed upload never half-updates the row.
    let uploaded: UploadedImage | null = null;
    if (file) {
      setUploading(true);
      try {
        uploaded = await uploadProductImage(file);
      } catch (error) {
        setUploading(false);
        return onError(error instanceof Error ? error.message : 'Rasm yuklanmadi.');
      }
      setUploading(false);
    }

    updateProduct.mutate(
      {
        id: product.id,
        data: {
          category_id: Number(draft.category_id),
          name: draft.name.trim(),
          description: draft.description.trim(),
          price,
          old_price: draft.old_price ? Number(draft.old_price) : null,
          unit: draft.unit,
          stock: Number(stock.toFixed(3)),
          is_popular: draft.is_popular,
          is_new: draft.is_new,
          active: draft.active,
          // Sending both together is what lets the server retire the file this
          // one replaces. Omitting them leaves the current image untouched.
          ...(uploaded ? { image_url: uploaded.url, image_public_id: uploaded.publicId } : {}),
        },
      },
      {
        onSuccess: () => { close(); onDone('Mahsulot yangilandi.'); },
        onError: () => onError('Mahsulotni saqlab bo‘lmadi.'),
      },
    );
  };

  const remove = () => {
    deleteProduct.mutate(
      { id: product.id },
      {
        onSuccess: () => { close(); onDone('Mahsulot o‘chirildi.'); },
        onError: () => onError('Mahsulotni o‘chirib bo‘lmadi.'),
      },
    );
  };

  return (
    <div
      data-testid={`row-admin-product-${product.id}`}
      className={`rounded-xl border p-3 ${
        product.active
          ? 'border-[hsl(var(--border))]'
          : 'border-dashed border-[hsl(var(--muted-foreground)/.4)] bg-[hsl(var(--muted)/.35)]'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[hsl(var(--muted))]">
            {product.image_url
              ? <img src={product.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
              : <ShoppingBasket size={16} className="text-[hsl(var(--muted-foreground))]" />}
          </div>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate text-sm font-bold">
              {product.name}
              {soldOut && (
                <span data-testid={`badge-sold-out-${product.id}`} className="shrink-0 rounded-full bg-[#fdecea] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#8c1d18]">
                  Tugagan
                </span>
              )}
              {!product.active && (
                <span className="shrink-0 rounded-full bg-[hsl(var(--muted-foreground)/.18)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide">
                  Yashirin
                </span>
              )}
              {product.is_popular && <Star size={12} className="shrink-0 text-[#c98a08]" />}
              {product.is_new && <Sparkles size={12} className="shrink-0 text-[hsl(var(--primary))]" />}
            </p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {product.category} · {product.stock} {product.unit} · {money(product.price)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {soldOut ? (
            <button
              type="button"
              data-testid={`button-restock-product-${product.id}`}
              onClick={openEditor}
              className="tap rounded-lg border border-[hsl(var(--primary)/.4)] px-2.5 py-2 text-[10px] font-bold text-[hsl(var(--primary))]"
            >
              Qoldiq kiritish
            </button>
          ) : (
            <button
              type="button"
              aria-label={`${product.name} tugab qoldi`}
              data-testid={`button-sold-out-product-${product.id}`}
              disabled={busy}
              onClick={markSoldOut}
              className="tap flex items-center gap-1 rounded-lg border border-[hsl(var(--border))] px-2.5 py-2 text-[10px] font-bold text-[#8c1d18] transition hover:border-[#b3261e] disabled:opacity-50"
            >
              <PackageX size={13} /> Tugab qoldi
            </button>
          )}
          <button
            type="button"
            aria-label={`${product.name} mahsulotini tahrirlash`}
            data-testid={`button-edit-product-${product.id}`}
            onClick={() => (open ? close() : openEditor())}
            className="tap rounded-lg border border-[hsl(var(--border))] p-2 transition hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary))]"
          >
            {open ? <X size={14} /> : <Pencil size={14} />}
          </button>
          <button
            type="button"
            aria-label={`${product.name} mahsulotini o‘chirish`}
            data-testid={`button-delete-product-${product.id}`}
            disabled={busy}
            onClick={() => setConfirmingDelete(true)}
            className="tap rounded-lg border border-[hsl(var(--border))] p-2 text-[#b3261e] transition hover:border-[#b3261e] disabled:opacity-50"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {confirmingDelete && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#fdecea] p-3">
          <p className="text-xs font-bold text-[#8c1d18]">
            Mahsulot va uning rasmi butunlay o‘chadi. Davom etamizmi?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid={`button-confirm-delete-${product.id}`}
              disabled={busy}
              onClick={remove}
              className="rounded-lg bg-[#b3261e] px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50"
            >
              {deleteProduct.isPending ? <LoaderCircle size={12} className="animate-spin" /> : 'Ha, o‘chirilsin'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="rounded-lg border border-[#b3261e]/30 px-3 py-2 text-[10px] font-bold text-[#8c1d18]"
            >
              Bekor qilish
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className="mt-3 grid gap-3 border-t border-[hsl(var(--border))] pt-3">
          <AdminImageField currentUrl={product.image_url} file={file} onPick={setFile} disabled={busy} />
          <div className="grid gap-3 sm:grid-cols-2">
            <select
              value={draft.category_id}
              onChange={event => setDraft({ ...draft, category_id: event.target.value })}
              className={fieldClass}
            >
              {categories.map(category => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
            <input
              value={draft.name}
              onChange={event => setDraft({ ...draft, name: event.target.value })}
              placeholder="Mahsulot nomi"
              className={fieldClass}
            />
            <input
              value={draft.description}
              onChange={event => setDraft({ ...draft, description: event.target.value })}
              placeholder="Qisqa tavsif"
              className={fieldClass}
            />
            <input
              type="number"
              min="0"
              value={draft.price}
              onChange={event => setDraft({ ...draft, price: event.target.value })}
              placeholder="Narxi"
              className={fieldClass}
            />
            <input
              type="number"
              min="0"
              value={draft.old_price}
              onChange={event => setDraft({ ...draft, old_price: event.target.value })}
              placeholder="Eski narx (ixtiyoriy)"
              className={fieldClass}
            />
            <select
              value={draft.unit}
              onChange={event => setDraft({ ...draft, unit: event.target.value as Unit })}
              className={fieldClass}
            >
              {UNITS.map(unit => <option key={unit} value={unit}>{unit}</option>)}
            </select>
            <input
              type="number"
              min="0"
              step={draft.unit === 'kg' || draft.unit === 'litr' ? '0.001' : '1'}
              value={draft.stock}
              onChange={event => setDraft({ ...draft, stock: event.target.value })}
              placeholder="Qoldiq"
              className={fieldClass}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <FlagToggle
              on={draft.active}
              label={draft.active ? 'Saytda ko‘rinadi' : 'Yashirilgan'}
              icon={draft.active ? Eye : EyeOff}
              onToggle={() => setDraft({ ...draft, active: !draft.active })}
              testId={`toggle-active-${product.id}`}
            />
            <FlagToggle
              on={draft.is_popular}
              label="Mashhur"
              icon={Star}
              onToggle={() => setDraft({ ...draft, is_popular: !draft.is_popular })}
              testId={`toggle-popular-${product.id}`}
            />
            <FlagToggle
              on={draft.is_new}
              label="Yangi"
              icon={Sparkles}
              onToggle={() => setDraft({ ...draft, is_new: !draft.is_new })}
              testId={`toggle-new-${product.id}`}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid={`button-save-product-${product.id}`}
              disabled={busy}
              onClick={save}
              className="tap flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] text-xs font-extrabold text-white disabled:opacity-50"
            >
              {busy && <LoaderCircle size={13} className="animate-spin" />}
              {uploading ? 'Rasm yuklanmoqda…' : updateProduct.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
            </button>
            <button
              type="button"
              onClick={close}
              className="h-11 rounded-xl border border-[hsl(var(--border))] px-4 text-xs font-bold"
            >
              Bekor qilish
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
