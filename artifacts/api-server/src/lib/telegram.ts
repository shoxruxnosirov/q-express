const TELEGRAM_API = "https://api.telegram.org";

type TelegramResult = {
  sent: boolean;
  error?: string;
};

type TelegramOrder = {
  id: number;
  orderNumber: string;
  customerName: string;
  phone: string;
  address: string;
  items: unknown;
  paymentMethod: string;
  subtotal: string | number | null;
  deliveryFee: string | number | null;
  total: string | number | null;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatMoney(value: string | number | null) {
  return `${Number(value ?? 0).toLocaleString("ru-RU")} so'm`;
}

export async function sendNewOrderNotification(order: TelegramOrder): Promise<TelegramResult> {
  const botMode = process.env.TELEGRAM_BOT_MODE ?? "legacy";
  if (botMode !== "legacy" && botMode !== "new") {
    return { sent: false, error: "Telegram bot mode is invalid" };
  }
  const token = botMode === "new"
    ? process.env.TELEGRAM_NEW_BOT_TOKEN
    : process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  if (!token || !chatId) {
    return { sent: false, error: "Telegram bot configuration is missing" };
  }

  const items = Array.isArray(order.items)
    ? order.items
        .map((item) => {
          const line = item as {
            name?: string;
            quantity?: number;
            unit?: string;
            total?: number;
            purchase_mode?: "quantity" | "amount";
            requested_amount?: number | null;
          };
          const quantity = `${line.quantity ?? 0} ${escapeHtml(line.unit ?? "")}`;
          const priceText = line.purchase_mode === "amount" && line.requested_amount != null
            ? `${formatMoney(line.requested_amount)} (~${quantity})`
            : formatMoney(line.total ?? 0);
          return `• ${escapeHtml(line.name ?? "Mahsulot")} × ${priceText}`;
        })
        .join("\n")
    : "• Mahsulotlar ro‘yxati mavjud emas";

  const text = [
    "<b>YANGI BUYURTMA</b>",
    "",
    `<b>Order:</b> #${escapeHtml(order.orderNumber)}`,
    `<b>Mijoz:</b> ${escapeHtml(order.customerName)}`,
    `<b>Telefon:</b> ${escapeHtml(order.phone)}`,
    "",
    "<b>Mahsulotlar:</b>",
    items,
    "",
    `<b>Mahsulotlar:</b> ${formatMoney(order.subtotal)}`,
    `<b>Yetkazib berish:</b> ${formatMoney(order.deliveryFee)}`,
    `<b>Jami:</b> ${formatMoney(order.total)}`,
    `<b>To‘lov:</b> ${escapeHtml(order.paymentMethod)}`,
    "",
    `<b>Manzil:</b> ${escapeHtml(order.address)}`,
  ].join("\n");

  try {
    const response = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    const result = (await response.json()) as { ok?: boolean; error_code?: number };
    if (!response.ok || !result.ok) {
      return { sent: false, error: `Telegram returned ${result.error_code ?? response.status}` };
    }

    return { sent: true };
  } catch {
    return {
      sent: false,
      // Fetch errors may contain the token-bearing URL. Never return raw errors.
      error: "Telegram request failed or timed out",
    };
  }
}