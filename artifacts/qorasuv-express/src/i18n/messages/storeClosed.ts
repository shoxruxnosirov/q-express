import { defineMessages } from '../core';

// {day} is "Ertaga" / "Завтра" / "Tomorrow" or a date; {time} is "06:00".
export default defineMessages({
  uz: {
    closedNow: 'Hozir yopiqmiz.',
    opensAt: '{day} soat {time} da ochilamiz.',
    hours: 'Ish vaqti {open}–{close}.',
    preorder: 'Oldindan buyurtma bering',
    paused: 'Hozir buyurtma qabul qilinmayapti. Birozdan keyin qayta urinib ko‘ring.',
  },
  ru: {
    closedNow: 'Сейчас мы закрыты.',
    opensAt: 'Откроемся: {day}, {time}.',
    hours: 'Часы работы: {open}–{close}.',
    preorder: 'Оформите предзаказ',
    paused: 'Сейчас заказы не принимаются. Попробуйте чуть позже.',
  },
  en: {
    closedNow: 'We are closed now.',
    opensAt: 'We open: {day}, {time}.',
    hours: 'Opening hours: {open}–{close}.',
    preorder: 'Place a pre-order',
    paused: 'We are not taking orders right now. Please try again a little later.',
  },
});
