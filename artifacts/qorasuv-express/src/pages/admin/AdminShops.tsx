import { FormEvent, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import {
  getListAdminShopsQueryKey,
  getListShopsQueryKey,
  useArchiveAdminShop,
  useConnectAdminShopBot,
  useCreateAdminShop,
  useRestoreAdminShop,
  useUpdateAdminShop,
  type AdminShop,
  type AdminShopUpdateInput,
} from '@workspace/api-client-react';
import { Archive, ArchiveRestore, Bot, Check, ExternalLink, LoaderCircle, Palette, Plus, RefreshCw, Settings2, Store, Trash2 } from 'lucide-react';
import { apiErrorMessage } from './AdminLogin';
import { useAsk } from '@/components/ConfirmDialog';
import { temporaryPassword } from './AdminAccounts';
import { RichHtmlField, type MultiLang } from '@/components/rich-text';
import { sanitizeHtml } from '@/lib/rich-html';
import { useAdminShop } from '@/lib/admin-shop';
import { dateLabel } from '@/lib/tashkent-time';

// The shops on the platform. Q express's admins see them all and may open any
// shop's card; only a Q express super admin creates a shop (with its bot and
// its first super admin) and sets each shop's hours and delivery fee.

const input = 'mt-1.5 h-11 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm outline-none focus:border-[hsl(var(--primary))] disabled:opacity-60';
const noAutoFix = { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false } as const;
const money = (value: number) => `${Math.round(value).toLocaleString('ru-RU')} so'm`;

// "Oila Market" → "oila-market"; the super admin may still change it.
function slugFrom(name: string) {
  return name
    .toLowerCase()
    .replace(/[‘'`’ʻ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// "Oila Market" → "OM".
function prefixFrom(name: string) {
  const letters = name.split(/\s+/).map(word => word.replace(/[^A-Za-z]/g, '').charAt(0)).join('').toUpperCase();
  return (letters.length >= 2 ? letters : name.replace(/[^A-Za-z]/g, '').toUpperCase()).slice(0, 4);
}

// Every shop's own copy of the card, cleaned as it is saved.
export function cleanCard(card: MultiLang): MultiLang {
  const result: MultiLang = {};
  for (const lang of ['uz', 'ru', 'en'] as const) {
    const html = card[lang] ? sanitizeHtml(card[lang]!) : '';
    if (html) result[lang] = html;
  }
  return result;
}

type Settings = {
  name: string;
  slug: string;
  order_prefix: string;
  bot_token: string;
  owner_chat_id: string;
  open_time: string;
  close_time: string;
  delivery_fee: string;
  free_first_delivery: boolean;
};

function SettingsFields({ value, onChange, platform, creating }: { value: Settings; onChange: (next: Settings) => void; platform: boolean; creating: boolean }) {
  const set = (patch: Partial<Settings>) => onChange({ ...value, ...patch });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-xs font-bold">Do‘kon nomi
        <input required minLength={2} maxLength={60} value={value.name} onChange={event => set(creating ? { name: event.target.value, slug: slugFrom(event.target.value), order_prefix: prefixFrom(event.target.value) } : { name: event.target.value })} placeholder="Oila Market" className={input} />
      </label>
      <label className="block text-xs font-bold">Manzil (slug)
        <input required pattern="[a-z0-9][a-z0-9\-]{1,39}" title="2–40 ta kichik lotin harfi, raqam yoki -" value={value.slug} disabled={platform} onChange={event => set({ slug: event.target.value.toLowerCase() })} placeholder="oila-market" {...noAutoFix} className={input} />
        {!platform && value.slug && <span className="mt-1 block text-[11px] font-normal text-[hsl(var(--muted-foreground))]">Sayt manzili: /s/{value.slug}</span>}
      </label>
      <label className="block text-xs font-bold">Buyurtma prefiksi
        <input required pattern="[A-Z]{2,4}" title="2–4 ta katta lotin harfi" value={value.order_prefix} onChange={event => set({ order_prefix: event.target.value.toUpperCase() })} placeholder="OM" {...noAutoFix} className={input} />
        <span className="mt-1 block text-[11px] font-normal text-[hsl(var(--muted-foreground))]">Buyurtma raqami: {value.order_prefix || 'XX'}-0000123</span>
      </label>
      <label className="block text-xs font-bold">Yetkazish narxi (so‘m)
        <input required type="number" min={0} max={10000000} step={1} value={value.delivery_fee} onChange={event => set({ delivery_fee: event.target.value })} className={input} />
      </label>
      <label className="block text-xs font-bold">Ochiladi
        <input required type="time" value={value.open_time} onChange={event => set({ open_time: event.target.value })} className={input} />
      </label>
      <label className="block text-xs font-bold">Yopiladi
        <input required type="time" value={value.close_time} onChange={event => set({ close_time: event.target.value })} className={input} />
      </label>
      <label className="flex items-center gap-2 text-xs font-bold sm:col-span-2">
        <input type="checkbox" checked={value.free_first_delivery} onChange={event => set({ free_first_delivery: event.target.checked })} className="h-4 w-4 accent-[hsl(var(--primary))]" />
        Har bir xonadonga birinchi yetkazish bepul
      </label>
      {!platform && <>
        <label className="block text-xs font-bold sm:col-span-2">Telegram bot tokeni
          <input required={creating} value={value.bot_token} onChange={event => set({ bot_token: event.target.value.trim() })} placeholder={creating ? '123456789:AA…' : 'O‘zgartirmaslik uchun bo‘sh qoldiring'} autoComplete="off" {...noAutoFix} className={`${input} mono`} />
          <span className="mt-1 block text-[11px] font-normal text-[hsl(var(--muted-foreground))]">Do‘kon uchun BotFather'da alohida bot yarating va tokenini shu yerga qo‘ying. Q express botiga hech narsa tushmaydi.</span>
        </label>
        <label className="block text-xs font-bold sm:col-span-2">Egasining Telegram chat ID raqami (ixtiyoriy)
          <input value={value.owner_chat_id} onChange={event => set({ owner_chat_id: event.target.value.trim() })} placeholder="123456789" inputMode="numeric" {...noAutoFix} className={input} />
          <span className="mt-1 block text-[11px] font-normal text-[hsl(var(--muted-foreground))]">Har bir buyurtma shu chatga ham boradi. Adminlar esa o‘z Telegramini «Profilim» bo‘limidan ulaydi.</span>
        </label>
      </>}
    </div>
  );
}

const emptySettings: Settings = {
  name: '', slug: '', order_prefix: '', bot_token: '', owner_chat_id: '',
  open_time: '08:00', close_time: '22:00', delivery_fee: '5000', free_first_delivery: false,
};

function CreateShop({ onDone }: { onDone: (text: string) => void }) {
  const qc = useQueryClient();
  const create = useCreateAdminShop();
  const [settings, setSettings] = useState<Settings>(emptySettings);
  const [card, setCard] = useState<MultiLang>({});
  const [owner, setOwner] = useState({ display_name: '', username: '' });
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ shop: string; username: string; password: string; bot: string | null } | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const password = temporaryPassword();
    create.mutate({
      data: {
        name: settings.name.trim(),
        slug: settings.slug,
        order_prefix: settings.order_prefix,
        bot_token: settings.bot_token,
        owner_chat_id: settings.owner_chat_id || null,
        open_time: settings.open_time,
        close_time: settings.close_time,
        delivery_fee: Number(settings.delivery_fee),
        free_first_delivery: settings.free_first_delivery,
        card: cleanCard(card),
        super_admin: { display_name: owner.display_name.trim(), username: owner.username.trim().toLowerCase(), role: 'super_admin', temporary_password: password },
      },
    }, {
      onSuccess: result => {
        setCreated({ shop: result.shop.name, username: result.admin.username, password, bot: result.shop.bot_username });
        setSettings(emptySettings);
        setCard({});
        setOwner({ display_name: '', username: '' });
        qc.invalidateQueries({ queryKey: getListAdminShopsQueryKey() });
        qc.invalidateQueries({ queryKey: getListShopsQueryKey() });
        onDone(`${result.shop.name} qo‘shildi.`);
      },
      onError: err => setError(apiErrorMessage(err, 'Do‘kon qo‘shilmadi.')),
    });
  };

  return (
    <form onSubmit={submit} data-testid="form-create-shop" className="space-y-5 rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 sm:p-6">
      <div className="flex items-center gap-2"><Plus size={18} className="text-[hsl(var(--primary))]" /><h2 className="text-sm font-extrabold">Yangi do‘kon</h2></div>
      <SettingsFields value={settings} onChange={setSettings} platform={false} creating />
      <div className="rounded-2xl bg-[hsl(var(--muted)/.6)] p-4">
        <p className="text-xs font-extrabold">Do‘konning super admini</p>
        <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">U do‘konga o‘zi adminlar qo‘shadi va do‘konni boshqaradi. Vaqtinchalik parol avtomatik yaratiladi, birinchi kirishda almashtiriladi.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-bold">Ismi
            <input required minLength={2} maxLength={60} value={owner.display_name} onChange={event => setOwner({ ...owner, display_name: event.target.value })} placeholder="Aziz" className={input} />
          </label>
          <label className="block text-xs font-bold">Login
            <input required pattern="[a-z0-9_.\-]{3,32}" title="3–32 ta kichik lotin harfi, raqam, _ . -" value={owner.username} onChange={event => setOwner({ ...owner, username: event.target.value.toLowerCase() })} placeholder="aziz" {...noAutoFix} className={input} />
          </label>
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-extrabold">Do‘kon ko‘rinishi (mijozlar ko‘radigan kartochka)</p>
        <RichHtmlField name="Do‘kon ko‘rinishi" value={card} onChange={setCard} />
        <p className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">Keyin ham «Ko‘rinish» bo‘limida o‘zgartirsa bo‘ladi.</p>
      </div>
      {error && <p role="alert" className="rounded-xl bg-[#fdf0ed] p-3 text-xs font-semibold text-[#9d493e]">{error}</p>}
      <button type="submit" disabled={create.isPending} data-testid="button-create-shop" className="tap flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] text-xs font-extrabold text-white disabled:opacity-50">
        {create.isPending && <LoaderCircle size={14} className="animate-spin" />} Do‘kon yaratish
      </button>
      {created && (
        <p role="status" data-testid="text-shop-created" className="rounded-xl bg-[#fff6dc] p-3 text-xs font-semibold text-[#7a4f07]">
          <Check size={13} className="mr-1 inline" />{created.shop} yaratildi{created.bot ? <>, boti <b>@{created.bot}</b></> : ''}.<br />
          Super admin logini: <b className="mono select-all">{created.username}</b><br />
          Vaqtinchalik parol: <b className="mono select-all text-sm">{created.password}</b><br />
          Buni do‘kon egasiga bering. Bu parol boshqa ko‘rsatilmaydi.<br />
          Bot hozir ulanmoqda: natijasi pastdagi ro‘yxatda, do‘kon yonida ko‘rinadi.
        </p>
      )}
    </form>
  );
}

function EditShop({ shop, onDone }: { shop: AdminShop; onDone: (text: string, isError?: boolean) => void }) {
  const qc = useQueryClient();
  const update = useUpdateAdminShop();
  const [settings, setSettings] = useState<Settings>({
    name: shop.name, slug: shop.slug, order_prefix: shop.order_prefix, bot_token: '', owner_chat_id: shop.owner_chat_id ?? '',
    open_time: shop.open_time, close_time: shop.close_time, delivery_fee: String(shop.delivery_fee), free_first_delivery: shop.free_first_delivery,
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data: AdminShopUpdateInput = {
      name: settings.name.trim(),
      order_prefix: settings.order_prefix,
      open_time: settings.open_time,
      close_time: settings.close_time,
      delivery_fee: Number(settings.delivery_fee),
      free_first_delivery: settings.free_first_delivery,
      ...(shop.is_platform ? {} : {
        slug: settings.slug,
        owner_chat_id: settings.owner_chat_id || null,
        ...(settings.bot_token ? { bot_token: settings.bot_token } : {}),
      }),
    };
    update.mutate({ id: shop.id, data }, {
      onSuccess: saved => {
        qc.invalidateQueries({ queryKey: getListAdminShopsQueryKey() });
        qc.invalidateQueries({ queryKey: getListShopsQueryKey() });
        onDone(`${saved.name} saqlandi.`);
      },
      onError: err => onDone(apiErrorMessage(err, 'Saqlab bo‘lmadi.'), true),
    });
  };
  return (
    <form onSubmit={submit} data-testid={`form-edit-shop-${shop.id}`} className="mt-4 space-y-4 border-t border-[hsl(var(--border))] pt-4">
      <SettingsFields value={settings} onChange={setSettings} platform={shop.is_platform} creating={false} />
      {shop.is_platform && <p className="text-[11px] text-[hsl(var(--muted-foreground))]">Q express boti va asosiy chati Render sozlamalarida (TELEGRAM_*) qoladi.</p>}
      <button type="submit" disabled={update.isPending} data-testid={`button-save-shop-${shop.id}`} className="tap flex h-11 items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-5 text-xs font-extrabold text-white disabled:opacity-50">
        {update.isPending && <LoaderCircle size={14} className="animate-spin" />} Saqlash
      </button>
    </form>
  );
}

// Whether the shop's bot is pointed at this server, as the server last tried
// it, with a button to try again when it did not connect.
function BotStatusLine({ shop, onMessage }: { shop: AdminShop; onMessage: (text: string, isError?: boolean) => void }) {
  const qc = useQueryClient();
  const connect = useConnectAdminShopBot();
  const retry = () => connect.mutate({ id: shop.id }, {
    onSuccess: saved => {
      qc.invalidateQueries({ queryKey: getListAdminShopsQueryKey() });
      if (saved.bot_status === 'connected') onMessage(`${saved.name} boti ulandi.`);
      else onMessage(`${saved.name} boti ulanmadi: ${saved.bot_error ?? 'Telegram javob bermadi'}`, true);
    },
    onError: err => onMessage(apiErrorMessage(err, 'Botni ulab bo‘lmadi.'), true),
  });
  if (!shop.is_platform && !shop.bot_username) return null;
  const busy = connect.isPending || shop.bot_status === 'connecting';
  const text = busy ? 'Bot ulanmoqda…'
    : shop.bot_status === 'connected' ? 'Bot ulangan'
    : shop.bot_status === 'failed' ? `Bot ulanmadi: ${shop.bot_error ?? 'Telegram javob bermadi'}`
    : 'Bot holati noma’lum (server hali ulamagan)';
  const tone = shop.bot_status === 'failed' && !busy ? 'bg-[#fdf0ed] text-[#9d493e]'
    : shop.bot_status === 'connected' && !busy ? 'bg-[#e8efdc] text-[hsl(var(--primary))]'
    : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]';
  return (
    <div data-testid={`bot-status-${shop.id}`} className={`mt-2 inline-flex flex-wrap items-center gap-2 rounded-xl px-2.5 py-1.5 text-[11px] font-semibold ${tone}`}>
      {busy ? <LoaderCircle size={12} className="animate-spin" /> : <Bot size={12} />}
      <span className="break-all">{text}</span>
      {!busy && shop.bot_status !== 'connected' && (
        <button type="button" onClick={retry} data-testid={`button-connect-bot-${shop.id}`} className="inline-flex items-center gap-1 rounded-full border border-current px-2 py-0.5 font-bold"><RefreshCw size={11} /> Qayta ulash</button>
      )}
    </div>
  );
}

function ShopRow({ shop, canManage, onMessage }: { shop: AdminShop; canManage: boolean; onMessage: (text: string, isError?: boolean) => void }) {
  const qc = useQueryClient();
  const update = useUpdateAdminShop();
  const { switchTo } = useAdminShop();
  const [, setLocation] = useLocation();
  const [editing, setEditing] = useState(false);
  const toggleActive = () => update.mutate({ id: shop.id, data: { active: !shop.active } }, {
    onSuccess: saved => {
      qc.invalidateQueries({ queryKey: getListAdminShopsQueryKey() });
      qc.invalidateQueries({ queryKey: getListShopsQueryKey() });
      onMessage(saved.active ? `${saved.name} mijozlarga ko‘rsatildi.` : `${saved.name} yashirildi.`);
    },
    onError: err => onMessage(apiErrorMessage(err, 'O‘zgartirib bo‘lmadi.'), true),
  });
  // "Deleting" archives the shop (the owner's choice). The name has to be typed
  // to confirm, so a slip of the finger cannot close a shop.
  const archive = useArchiveAdminShop();
  const restore = useRestoreAdminShop();
  const ask = useAsk();
  const refreshShops = () => {
    qc.invalidateQueries({ queryKey: getListAdminShopsQueryKey() });
    qc.invalidateQueries({ queryKey: getListShopsQueryKey() });
  };
  const archiveShop = async () => {
    const typed = await ask({
      message: `${shop.name} o‘chirilsinmi? Do‘kon mijozlardan yashiriladi, boti to‘xtaydi, adminlari kira olmaydi. Buyurtmalar, suhbatlar va mijozlar tarixi arxivda saqlanadi, keyin do‘konni qaytarsa bo‘ladi.`,
      inputLabel: `Tasdiqlash uchun do‘kon nomini yozing: ${shop.name}`,
      maxLength: 80,
      confirmLabel: 'O‘chirish',
      danger: true,
    });
    if (typed === null) return;
    if (typed.trim() !== shop.name) {
      onMessage('Nom mos kelmadi, do‘kon o‘chirilmadi.', true);
      return;
    }
    archive.mutate({ id: shop.id }, {
      onSuccess: saved => { refreshShops(); onMessage(`${saved.name} o‘chirildi (arxivga olindi).`); },
      onError: err => onMessage(apiErrorMessage(err, 'O‘chirib bo‘lmadi.'), true),
    });
  };
  const restoreShop = () => restore.mutate({ id: shop.id }, {
    onSuccess: saved => { refreshShops(); onMessage(`${saved.name} arxivdan qaytarildi. Mijozlarga ko‘rsatish uchun «Ko‘rsatish»ni bosing.`); },
    onError: err => onMessage(apiErrorMessage(err, 'Qaytarib bo‘lmadi.'), true),
  });
  const archived = Boolean(shop.archived_at);
  const storefront = shop.is_platform ? '/' : `/s/${shop.slug}`;
  if (archived) {
    return (
      <div data-testid={`row-shop-${shop.id}`} className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)/.4)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-extrabold text-[hsl(var(--muted-foreground))]"><Archive size={16} />{shop.name}<span className="rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[10px] font-bold">arxivda</span></p>
            <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">#{shop.order_prefix}-… · {dateLabel(new Date(shop.archived_at!))} kuni o‘chirilgan</p>
          </div>
          {canManage && <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { switchTo(shop.id); setLocation('/admin/orders'); }} data-testid={`button-enter-shop-${shop.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-bold">Tarixni ko‘rish</button>
            <button type="button" onClick={restoreShop} disabled={restore.isPending} data-testid={`button-restore-shop-${shop.id}`} className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"><ArchiveRestore size={13} /> Arxivdan qaytarish</button>
          </div>}
        </div>
      </div>
    );
  }
  return (
    <div data-testid={`row-shop-${shop.id}`} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-extrabold"><Store size={16} className="text-[hsl(var(--primary))]" />{shop.name}{!shop.active && <span className="rounded-full bg-[#fdecea] px-2 py-0.5 text-[10px] font-bold text-[#8c1d18]">yashirin</span>}{shop.is_platform && <span className="rounded-full bg-[#25483e] px-2 py-0.5 text-[10px] font-bold text-white">platforma</span>}</p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[hsl(var(--muted-foreground))]">
            <a href={storefront} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[hsl(var(--primary))]">{storefront} <ExternalLink size={11} /></a>
            <span>#{shop.order_prefix}-…</span>
            <span>{shop.open_time}–{shop.close_time}{shop.accepting_orders ? '' : ' · to‘xtatilgan'}</span>
            <span>Yetkazish: {money(shop.delivery_fee)}{shop.free_first_delivery ? ' · birinchisi bepul' : ''}</span>
            {!shop.is_platform && <span className="inline-flex items-center gap-1"><Bot size={11} />{shop.bot_username ? `@${shop.bot_username}` : 'bot kiritilmagan'}{!shop.bot_configured && ' · token o‘qilmadi, qayta kiriting'}</span>}
          </div>
          {canManage && <BotStatusLine shop={shop} onMessage={onMessage} />}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/admin/shop-card?shop=${shop.id}`} data-testid={`link-shop-card-${shop.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-bold"><Palette size={13} /> Ko‘rinish</Link>
          {canManage && <button type="button" onClick={() => setEditing(!editing)} data-testid={`button-edit-shop-${shop.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-bold"><Settings2 size={13} /> Sozlamalar</button>}
          {canManage && <button type="button" onClick={() => { switchTo(shop.id); setLocation('/admin'); }} data-testid={`button-enter-shop-${shop.id}`} className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-bold text-white">Boshqarish</button>}
          {canManage && !shop.is_platform && <button type="button" onClick={toggleActive} disabled={update.isPending} data-testid={`button-toggle-shop-${shop.id}`} className="rounded-full border border-[#e6b2a8] px-3 py-1.5 text-xs font-bold text-[#9d493e] disabled:opacity-50">{shop.active ? 'Yashirish' : 'Ko‘rsatish'}</button>}
          {canManage && !shop.is_platform && <button type="button" onClick={() => void archiveShop()} disabled={archive.isPending} data-testid={`button-archive-shop-${shop.id}`} className="inline-flex items-center gap-1.5 rounded-full bg-[#9d493e] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"><Trash2 size={13} /> O‘chirish</button>}
        </div>
      </div>
      {editing && <EditShop shop={shop} onDone={(text, isError) => { onMessage(text, isError); if (!isError) setEditing(false); }} />}
    </div>
  );
}

export function AdminShops() {
  const { admin, shops, platformAdmin, platformSuper } = useAdminShop();
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const qc = useQueryClient();
  // A bot being connected in the background: the list is asked again until
  // the server has the outcome.
  const connecting = platformSuper && shops.some(shop => shop.bot_status === 'connecting');
  useEffect(() => {
    if (!connecting) return;
    const timer = window.setTimeout(() => void qc.invalidateQueries({ queryKey: getListAdminShopsQueryKey() }), 3000);
    return () => window.clearTimeout(timer);
  }, [connecting, shops, qc]);
  const current = shops.filter(shop => !shop.archived_at);
  const archived = shops.filter(shop => shop.archived_at);
  const showMessage = (text: string, isError = false) => setMessage({ text, isError });
  if (!admin) return <div className="container-wide py-10"><div className="skeleton h-64 rounded-[26px]" /></div>;
  if (!platformAdmin) {
    return <div className="container-wide py-10"><p className="rounded-2xl bg-[hsl(var(--muted))] p-5 text-sm font-semibold">Bu bo‘lim Q express adminlari uchun.</p></div>;
  }
  return (
    <div className="container-wide py-7 sm:py-10">
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">Platforma / Do‘konlar</p>
          <h1 className="display mt-2 text-4xl font-extrabold sm:text-5xl">Do‘konlar</h1>
          <p className="mt-2 max-w-[640px] text-sm text-[hsl(var(--muted-foreground))]">Har bir do‘konning o‘z kategoriyalari, mahsulotlari, adminlari, boti, ish vaqti, yetkazish narxi va mijozlar uchun alohida savati bor.</p>
        </div>
        {platformSuper && <button type="button" onClick={() => setCreating(!creating)} data-testid="button-new-shop" className="tap inline-flex h-11 items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 text-xs font-extrabold text-white"><Plus size={15} /> Yangi do‘kon</button>}
      </div>
      {message && <p role="status" className={`mb-4 rounded-xl p-3 text-sm font-semibold ${message.isError ? 'bg-[#fdf0ed] text-[#9d493e]' : 'bg-[#e8efdc] text-[hsl(var(--primary))]'}`}>{message.text}</p>}
      {creating && platformSuper && <div className="mb-5"><CreateShop onDone={text => setMessage({ text, isError: false })} /></div>}
      <section className="space-y-2">
        {current.map(shop => <ShopRow key={shop.id} shop={shop} canManage={platformSuper} onMessage={showMessage} />)}
      </section>
      {archived.length > 0 && (
        <section data-testid="section-archived-shops" className="mt-8 space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-extrabold text-[hsl(var(--muted-foreground))]"><Archive size={15} /> Arxiv (o‘chirilgan do‘konlar)</h2>
          {archived.map(shop => <ShopRow key={shop.id} shop={shop} canManage={platformSuper} onMessage={showMessage} />)}
        </section>
      )}
    </div>
  );
}
