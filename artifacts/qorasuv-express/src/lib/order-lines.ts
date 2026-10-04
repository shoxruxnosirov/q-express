import type { OrderItem } from '@workspace/api-client-react';

const money = (value: number) => `${Math.round(value).toLocaleString('ru-RU')} so'm`;

// "3 dona", "0.5 kg": pieces and packs are whole, weight and volume keep up
// to three decimals without floating-point noise. The same rule as the admin
// Telegram notification, so the dashboard and Telegram agree.
export function formatQuantity(quantity: number, unit: string) {
  const whole = unit === 'dona' || unit === 'qadoq';
  const shown = whole ? String(Math.round(quantity)) : String(Number(quantity.toFixed(3)));
  return `${shown} ${unit}`.trim();
}

// One line of an order for the admins: how many, at what price, for how much;
// a line bought by amount says the amount and the weight it came to.
export function orderLineParts(line: OrderItem) {
  const quantity = formatQuantity(line.quantity, line.unit);
  if (line.purchase_mode === 'amount' && line.requested_amount != null) {
    return { name: line.name, quantity: `${money(line.requested_amount)}lik (~${quantity})`, total: money(line.total) };
  }
  return { name: line.name, quantity: `${quantity} × ${money(line.price)}`, total: money(line.total) };
}
