import { defineText } from '../../lib/i18n-text.ts';

// Node-safe (see lib/i18n-text.ts): lib/tashkent-time.ts uses it.
// date: "30-sentabr" / "30 сентября" / "30 September".
export default defineText({
  uz: {
    today: 'Bugun',
    tomorrow: 'Ertaga',
    dayAfterTomorrow: 'Indinga',
    date: '{day}-{month}',
    m1: 'yanvar', m2: 'fevral', m3: 'mart', m4: 'aprel', m5: 'may', m6: 'iyun',
    m7: 'iyul', m8: 'avgust', m9: 'sentabr', m10: 'oktabr', m11: 'noyabr', m12: 'dekabr',
  },
  ru: {
    today: 'Сегодня',
    tomorrow: 'Завтра',
    dayAfterTomorrow: 'Послезавтра',
    date: '{day} {month}',
    m1: 'января', m2: 'февраля', m3: 'марта', m4: 'апреля', m5: 'мая', m6: 'июня',
    m7: 'июля', m8: 'августа', m9: 'сентября', m10: 'октября', m11: 'ноября', m12: 'декабря',
  },
  en: {
    today: 'Today',
    tomorrow: 'Tomorrow',
    dayAfterTomorrow: 'Day after tomorrow',
    date: '{day} {month}',
    m1: 'January', m2: 'February', m3: 'March', m4: 'April', m5: 'May', m6: 'June',
    m7: 'July', m8: 'August', m9: 'September', m10: 'October', m11: 'November', m12: 'December',
  },
});
