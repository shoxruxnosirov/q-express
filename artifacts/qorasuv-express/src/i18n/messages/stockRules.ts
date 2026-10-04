import { defineText } from '../../lib/i18n-text.ts';

// Node-safe (see lib/i18n-text.ts): lib/stock-rules.ts uses it.
export default defineText({
  uz: {
    gone: 'Bu mahsulot endi sotuvda yo‘q. Savatdan olib tashlang.',
    soldOut: 'Tugagan. Savatdan olib tashlang.',
    short: 'Omborda faqat {available} {unit} qoldi. Miqdorni o‘zgartiring.',
  },
  ru: {
    gone: 'Этого товара больше нет в продаже. Уберите его из корзины.',
    soldOut: 'Закончился. Уберите его из корзины.',
    short: 'В наличии осталось только {available} {unit}. Измените количество.',
  },
  en: {
    gone: 'This product is no longer on sale. Please remove it from your cart.',
    soldOut: 'Sold out. Please remove it from your cart.',
    short: 'Only {available} {unit} left in stock. Please change the quantity.',
  },
});
