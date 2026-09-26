// Every phone is stored as 998XXXXXXXXX, so the same number typed three ways
// is one customer for the first-order rule, the leaderboard and verification.
// The shop only delivers locally, so only Uzbek numbers are accepted.

export function normalizeUzPhone(input: string): string | undefined {
  const digits = input.replace(/\D/g, "");
  if (/^998\d{9}$/.test(digits)) return digits;
  // A local number without the country code: 90 123 45 67.
  if (/^\d{9}$/.test(digits)) return `998${digits}`;
  // The old trunk prefix: 8 90 123 45 67.
  if (/^8\d{9}$/.test(digits)) return `998${digits.slice(1)}`;
  return undefined;
}

// +998 90 123 45 67, for showing a stored number back to people.
export function formatUzPhone(phone: string) {
  const match = /^998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return match ? `+998 ${match[1]} ${match[2]} ${match[3]} ${match[4]}` : phone;
}
