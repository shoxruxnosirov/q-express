/** Integer arithmetic used at the order boundary. Monetary values are UZS
 * cents and quantities are millionths of a kg/litr (or unit count). */
export const MICROQUANTITY_SCALE = 1_000_000;

export function deriveAmountQuantityMicro(amountCents: number, priceCents: number) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error("amount cents must be a positive safe integer");
  }
  if (!Number.isSafeInteger(priceCents) || priceCents <= 0) {
    throw new Error("price cents must be a positive safe integer");
  }
  const numerator = BigInt(amountCents) * BigInt(MICROQUANTITY_SCALE);
  const rounded = (numerator + BigInt(priceCents) / 2n) / BigInt(priceCents);
  const quantityMicro = Number(rounded);
  if (!Number.isSafeInteger(quantityMicro)) {
    throw new Error("derived quantity exceeds safe integer range");
  }
  return quantityMicro;
}

export function quantityTotalCents(priceCents: number, quantityMicro: number) {
  if (!Number.isSafeInteger(priceCents) || priceCents <= 0) {
    throw new Error("price cents must be a positive safe integer");
  }
  if (!Number.isSafeInteger(quantityMicro) || quantityMicro <= 0) {
    throw new Error("quantity must be a positive safe integer");
  }
  const total = (BigInt(priceCents) * BigInt(quantityMicro) + 500_000n) / 1_000_000n;
  const totalCents = Number(total);
  if (!Number.isSafeInteger(totalCents)) {
    throw new Error("total exceeds safe integer range");
  }
  return totalCents;
}

export function addMicroquantities(...values: number[]) {
  const total = values.reduce((sum, value) => {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("quantity must be a non-negative safe integer");
    }
    const next = sum + value;
    if (!Number.isSafeInteger(next)) {
      throw new Error("quantity exceeds safe integer range");
    }
    return next;
  }, 0);
  return total;
}

export function requireWholeUnitQuantity(quantityMicro: number) {
  if (!Number.isSafeInteger(quantityMicro) || quantityMicro <= 0 || quantityMicro % MICROQUANTITY_SCALE !== 0) {
    throw new Error("whole positive quantity required");
  }
  return quantityMicro;
}