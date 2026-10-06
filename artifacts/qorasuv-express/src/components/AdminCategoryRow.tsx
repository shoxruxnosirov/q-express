import { useState } from 'react';
import { Eye, EyeOff, LoaderCircle, Pencil, Trash2, X } from 'lucide-react';
import { useDeleteAdminCategory, useUpdateAdminCategory, type AdminCategory } from '@workspace/api-client-react';
import { apiErrorMessage } from '@/pages/admin/AdminLogin';
import { CATEGORY_ICONS, categoryIcon } from '@/components/category-icons';
import { useConfirm } from '@/components/ConfirmDialog';
import { toLatin } from '@/i18n/translit';

const fieldClass =
  'h-11 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm outline-none focus:border-[hsl(var(--primary))]';

// A name typed in Cyrillic still gets a Latin slug.
export const slugify = (value: string) =>
  toLatin(value).toLowerCase().trim().replace(/['’‘ʻʼ`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const SLUG_PATTERN = /^[a-z0-9-]+$/;

export function CategoryIconPicker({ value, onPick, disabled = false }: { value: string; onPick: (name: string) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Kategoriya ikonkasi" className="flex flex-wrap gap-1.5">
      {CATEGORY_ICONS.map(({ name, label, Icon }) => (
        <button
          key={name}
          type="button"
          role="radio"
          aria-checked={value === name}
          aria-label={label}
          title={label}
          disabled={disabled}
          data-testid={`icon-${name}`}
          onClick={() => onPick(name)}
          className={`tap flex h-9 w-9 items-center justify-center rounded-xl border transition disabled:opacity-50 ${
            value === name
              ? 'border-transparent bg-[hsl(var(--primary))] text-white'
              : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary))]'
          }`}
        >
          <Icon size={16} />
        </button>
      ))}
    </div>
  );
}

export function AdminCategoryRow({
  category,
  index,
  onShowProducts,
  onDone,
  onError,
}: {
  category: AdminCategory;
  index: number;
  onShowProducts: (categoryId: number) => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const updateCategory = useUpdateAdminCategory();
  const deleteCategory = useDeleteAdminCategory();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const draftFrom = (current: AdminCategory) => ({
    name: current.name,
    slug: current.slug,
    icon: current.icon,
    sort_order: String(current.sort_order),
  });
  const [draft, setDraft] = useState(() => draftFrom(category));
  const busy = updateCategory.isPending || deleteCategory.isPending;
  const Icon = categoryIcon(category.icon, index);
  const hasProducts = category.product_count > 0;

  const openEditor = () => {
    setDraft(draftFrom(category));
    setConfirmingDelete(false);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setConfirmingDelete(false);
  };

  const save = () => {
    const name = draft.name.trim();
    const slug = draft.slug.trim().toLowerCase();
    const sortOrder = Number(draft.sort_order);
    if (name.length < 2) return onError('Kategoriya nomi kamida 2 harf bo‘lsin.');
    if (slug.length < 2 || !SLUG_PATTERN.test(slug)) return onError('Slug faqat kichik lotin harf, raqam va "-" dan iborat bo‘lsin.');
    if (!Number.isInteger(sortOrder) || sortOrder < 0) return onError('Tartib raqami 0 yoki undan katta butun son bo‘lsin.');
    updateCategory.mutate(
      { id: category.id, data: { name, slug, icon: draft.icon, sort_order: sortOrder } },
      {
        onSuccess: () => { close(); onDone(`"${name}" kategoriyasi yangilandi.`); },
        onError: error => onError(apiErrorMessage(error, 'Kategoriyani saqlab bo‘lmadi.')),
      },
    );
  };

  const toggleActive = async () => {
    const active = !category.active;
    if (!active && hasProducts && !(await confirm({
      message: `"${category.name}" yashirilsa, undagi ${category.product_count} ta mahsulot ham saytdan yo‘qoladi. Davom etamizmi?`,
      confirmLabel: 'Yashirish',
    }))) return;
    updateCategory.mutate(
      { id: category.id, data: { active } },
      {
        onSuccess: () => onDone(active
          ? `"${category.name}" saytda yana ko‘rinadi.`
          : `"${category.name}" va undagi mahsulotlar saytdan yashirildi.`),
        onError: error => onError(apiErrorMessage(error, 'Kategoriyani o‘zgartirib bo‘lmadi.')),
      },
    );
  };

  const askDelete = () => {
    if (hasProducts) {
      return onError(`"${category.name}" ichida ${category.product_count} ta mahsulot bor. Avval ularni boshqa kategoriyaga o‘tkazing yoki o‘chiring.`);
    }
    setOpen(false);
    setConfirmingDelete(true);
  };

  const remove = () => {
    deleteCategory.mutate(
      { id: category.id },
      {
        onSuccess: () => { close(); onDone(`"${category.name}" kategoriyasi o‘chirildi.`); },
        onError: error => { setConfirmingDelete(false); onError(apiErrorMessage(error, 'Kategoriyani o‘chirib bo‘lmadi.')); },
      },
    );
  };

  return (
    <div
      data-testid={`row-admin-category-${category.id}`}
      className={`rounded-xl border p-2.5 ${
        category.active
          ? 'border-[hsl(var(--border))] bg-[hsl(var(--card))]'
          : 'border-dashed border-[hsl(var(--muted-foreground)/.4)] bg-[hsl(var(--muted)/.35)]'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#e8efdc] text-[hsl(var(--primary))]">
            <Icon size={17} />
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate text-sm font-bold">
              {category.name}
              {!category.active && (
                <span className="shrink-0 rounded-full bg-[hsl(var(--muted-foreground)/.18)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide">
                  Yashirin
                </span>
              )}
            </p>
            <p className="truncate text-[11px] text-[hsl(var(--muted-foreground))]">
              <button
                type="button"
                data-testid={`button-category-products-${category.id}`}
                onClick={() => onShowProducts(category.id)}
                className="font-bold text-[hsl(var(--primary))] hover:underline"
              >
                {category.product_count} ta mahsulot
              </button>
              {' · '}/{category.slug} · #{category.sort_order}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={category.active ? `${category.name} kategoriyasini yashirish` : `${category.name} kategoriyasini ko‘rsatish`}
            title={category.active ? 'Saytdan yashirish' : 'Saytda ko‘rsatish'}
            data-testid={`button-toggle-category-${category.id}`}
            disabled={busy}
            onClick={toggleActive}
            className="tap rounded-lg border border-[hsl(var(--border))] p-2 transition hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary))] disabled:opacity-50"
          >
            {category.active ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          <button
            type="button"
            aria-label={`${category.name} kategoriyasini tahrirlash`}
            data-testid={`button-edit-category-${category.id}`}
            onClick={() => (open ? close() : openEditor())}
            className="tap rounded-lg border border-[hsl(var(--border))] p-2 transition hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary))]"
          >
            {open ? <X size={14} /> : <Pencil size={14} />}
          </button>
          <button
            type="button"
            aria-label={`${category.name} kategoriyasini o‘chirish`}
            title={hasProducts ? 'Ichida mahsulot bor' : 'O‘chirish'}
            data-testid={`button-delete-category-${category.id}`}
            disabled={busy}
            onClick={askDelete}
            className={`tap rounded-lg border border-[hsl(var(--border))] p-2 transition disabled:opacity-50 ${
              hasProducts ? 'text-[hsl(var(--muted-foreground))]' : 'text-[#b3261e] hover:border-[#b3261e]'
            }`}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {confirmingDelete && (
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#fdecea] p-3">
          <p className="text-xs font-bold text-[#8c1d18]">"{category.name}" kategoriyasi butunlay o‘chadi. Davom etamizmi?</p>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid={`button-confirm-delete-category-${category.id}`}
              disabled={busy}
              onClick={remove}
              className="rounded-lg bg-[#b3261e] px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50"
            >
              {deleteCategory.isPending ? <LoaderCircle size={12} className="animate-spin" /> : 'Ha, o‘chirilsin'}
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
        <div className="mt-2.5 grid gap-3 border-t border-[hsl(var(--border))] pt-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_90px]">
            <input
              value={draft.name}
              onChange={event => setDraft({ ...draft, name: event.target.value })}
              placeholder="Kategoriya nomi"
              aria-label="Kategoriya nomi"
              className={fieldClass}
            />
            <input
              value={draft.slug}
              onChange={event => setDraft({ ...draft, slug: event.target.value })}
              placeholder="slug"
              aria-label="Slug"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className={fieldClass}
            />
            <input
              type="number"
              min="0"
              step="1"
              value={draft.sort_order}
              onChange={event => setDraft({ ...draft, sort_order: event.target.value })}
              aria-label="Tartib raqami"
              title="Tartib raqami: kichigi oldinda turadi"
              className={fieldClass}
            />
          </div>
          {draft.slug.trim() !== category.slug && (
            <p className="text-[11px] text-[#8c5b00]">Slug o‘zgarsa, shu kategoriyaga oldin ulashilgan havolalar ochilmay qoladi.</p>
          )}
          <CategoryIconPicker value={draft.icon} onPick={icon => setDraft({ ...draft, icon })} disabled={busy} />
          <div className="flex gap-2">
            <button
              type="button"
              data-testid={`button-save-category-${category.id}`}
              disabled={busy}
              onClick={save}
              className="tap flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] text-xs font-extrabold text-white disabled:opacity-50"
            >
              {updateCategory.isPending && <LoaderCircle size={13} className="animate-spin" />}
              {updateCategory.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
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
