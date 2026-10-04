import { defineText } from '../../lib/i18n-text.ts';

// Node-safe (see lib/i18n-text.ts): lib/profile.ts uses it.
export default defineText({
  uz: {
    nameShort: 'Ism kamida 2 ta harf bo‘lsin.',
    phoneShort: 'Telefon raqam to‘liq emas.',
  },
  ru: {
    nameShort: 'Имя должно содержать минимум 2 буквы.',
    phoneShort: 'Номер телефона указан не полностью.',
  },
  en: {
    nameShort: 'Name must be at least 2 letters.',
    phoneShort: 'The phone number is incomplete.',
  },
});
