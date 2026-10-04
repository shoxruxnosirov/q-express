// "Aziz Karimov (@aziz)": who a customer is in Telegram, for the admins, next
// to what the customer typed. Empty when Telegram told us nothing.
export function telegramLabel(source: { telegram_name?: string | null; telegram_username?: string | null }) {
  const name = source.telegram_name?.trim() ?? '';
  const username = source.telegram_username ? `@${source.telegram_username}` : '';
  if (name && username) return `${name} (${username})`;
  return name || username;
}

// A t.me link to the customer's Telegram, when they have a @username.
export function telegramProfileUrl(source: { telegram_username?: string | null }) {
  return source.telegram_username ? `https://t.me/${source.telegram_username}` : undefined;
}
