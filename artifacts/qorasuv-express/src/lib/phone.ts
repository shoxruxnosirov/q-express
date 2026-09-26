// Mirrors the server: every phone is 998XXXXXXXXX, and only Uzbek numbers are
// accepted. Kept here so the form can say so before a round trip.

export function normalizeUzPhone(input: string): string | undefined {
  const digits = input.replace(/\D/g, '');
  if (/^998\d{9}$/.test(digits)) return digits;
  if (/^\d{9}$/.test(digits)) return `998${digits}`;
  if (/^8\d{9}$/.test(digits)) return `998${digits.slice(1)}`;
  return undefined;
}

// +998 90 123 45 67
export function formatUzPhone(phone: string) {
  const match = /^998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return match ? `+998 ${match[1]} ${match[2]} ${match[3]} ${match[4]}` : phone;
}

export const samePhone = (a: string, b: string) => {
  const left = normalizeUzPhone(a);
  return Boolean(left) && left === normalizeUzPhone(b);
};
