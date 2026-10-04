import { defineMessages } from "./i18n.ts";

// What the server says to customers, in every language the storefront
// speaks. Uzbek (Latin) is the source; Uzbek Cyrillic is made from it by
// transliteration, and Russian and English must have every Uzbek key (the
// types refuse a missing one). What the admins read stays Uzbek and is not
// here.

// Errors any request can end in.
export const commonMessages = defineMessages({
  uz: {
    invalidInput: "Kiritilgan ma'lumotlar noto‘g‘ri",
    serverError: "Serverda xatolik yuz berdi",
    tooManyAttempts: "Juda ko‘p urinish. Birozdan keyin qayta urinib ko‘ring.",
  },
  ru: {
    invalidInput: "Введены неверные данные",
    serverError: "На сервере произошла ошибка",
    tooManyAttempts: "Слишком много попыток. Попробуйте ещё раз чуть позже.",
  },
  en: {
    invalidInput: "Some of the details entered are not valid",
    serverError: "Something went wrong on the server",
    tooManyAttempts: "Too many attempts. Please try again a little later.",
  },
});

// The customer's account: signing in, the profile and saved addresses.
export const accountMessages = defineMessages({
  uz: {
    blocked: "Hisobingiz do‘kon tomonidan bloklangan. Buyurtma berish va yozish imkoni yo‘q.",
    phoneInvalid: "Telefon raqam noto‘g‘ri. Masalan: +998 90 123 45 67",
    nameLength: "Ism 2–80 ta belgidan iborat bo‘lsin",
    addressInvalid: "Manzil noto‘g‘ri",
    botNotConfigured: "Telegram bot sozlanmagan",
    telegramNotVerified: "Telegram ma’lumoti tasdiqlanmadi",
  },
  ru: {
    blocked: "Ваш аккаунт заблокирован магазином. Оформлять заказы и писать сообщения нельзя.",
    phoneInvalid: "Неверный номер телефона. Например: +998 90 123 45 67",
    nameLength: "Имя должно содержать от 2 до 80 символов",
    addressInvalid: "Неверный адрес",
    botNotConfigured: "Telegram-бот не настроен",
    telegramNotVerified: "Не удалось подтвердить данные Telegram",
  },
  en: {
    blocked: "Your account has been blocked by the shop. You cannot place orders or send messages.",
    phoneInvalid: "Invalid phone number. For example: +998 90 123 45 67",
    nameLength: "Name must be 2–80 characters long",
    addressInvalid: "Invalid address",
    botNotConfigured: "The Telegram bot is not set up",
    telegramNotVerified: "Telegram data could not be verified",
  },
});

// The catalogue.
export const catalogMessages = defineMessages({
  uz: {
    productNotFound: "Mahsulot topilmadi",
  },
  ru: {
    productNotFound: "Товар не найден",
  },
  en: {
    productNotFound: "Product not found",
  },
});

// Placing an order, reading one, and commenting on a delivered one.
export const orderMessages = defineMessages({
  uz: {
    telegramRequired: "Buyurtma Telegram'dagi do‘kon orqali qabul qilinadi. Do‘konni Telegram'da oching.",
    customerNameLength: "Mijoz ismi 2-80 ta belgidan iborat bo‘lishi kerak",
    notAcceptingNow: "Hozir buyurtma qabul qilinmayapti. Birozdan keyin urinib ko‘ring.",
    closedNow: "Do‘kon hozir yopiq. Ish vaqti {open}–{close}. Yetkazish vaqtini tanlab, oldindan buyurtma bering.",
    notFound: "Buyurtma topilmadi",
    feedbackEmpty: "Izoh bo‘sh bo‘lmasin",
    feedbackNotDelivered: "Izohni buyurtma yetkazilgandan keyin yozish mumkin",
    feedbackLimit: "Bu buyurtma uchun bugun yetarlicha izoh yozildi. Ertaga yozishingiz mumkin.",
    feedbackFailed: "Izoh yuborilmadi. Birozdan keyin qayta urinib ko‘ring.",
  },
  ru: {
    telegramRequired: "Заказы принимаются через магазин в Telegram. Откройте магазин в Telegram.",
    customerNameLength: "Имя покупателя должно содержать от 2 до 80 символов",
    notAcceptingNow: "Сейчас заказы не принимаются. Попробуйте чуть позже.",
    closedNow: "Магазин сейчас закрыт. Часы работы: {open}–{close}. Выберите время доставки и оформите предзаказ.",
    notFound: "Заказ не найден",
    feedbackEmpty: "Комментарий не может быть пустым",
    feedbackNotDelivered: "Оставить комментарий можно после доставки заказа",
    feedbackLimit: "Сегодня к этому заказу уже оставлено достаточно комментариев. Напишите завтра.",
    feedbackFailed: "Комментарий не отправлен. Попробуйте ещё раз чуть позже.",
  },
  en: {
    telegramRequired: "Orders are taken through the shop in Telegram. Please open the shop in Telegram.",
    customerNameLength: "Customer name must be 2–80 characters long",
    notAcceptingNow: "We are not taking orders right now. Please try again a little later.",
    closedNow: "The shop is closed right now. Opening hours: {open}–{close}. Choose a delivery time to order ahead.",
    notFound: "Order not found",
    feedbackEmpty: "The comment cannot be empty",
    feedbackNotDelivered: "You can leave a comment once the order has been delivered",
    feedbackLimit: "Enough comments have been sent for this order today. You can write again tomorrow.",
    feedbackFailed: "The comment was not sent. Please try again a little later.",
  },
});

// What a number in an order (or a product) is, for the problems below.
export const valueLabels = defineMessages({
  uz: {
    price: "Narx",
    oldPrice: "Eski narx",
    stock: "Ombor qoldig‘i",
    quantity: "Miqdor",
    amount: "Summa",
  },
  ru: {
    price: "Цена",
    oldPrice: "Старая цена",
    stock: "Остаток на складе",
    quantity: "Количество",
    amount: "Сумма",
  },
  en: {
    price: "Price",
    oldPrice: "Old price",
    stock: "Stock",
    quantity: "Quantity",
    amount: "Amount",
  },
});

export type ValueLabel = keyof typeof valueLabels.uz;

// Why an order (or a product an admin saves) was refused. {label} is one of
// the value labels above, {name} a product's name. The admin-only ones are
// shown to admins in Uzbek, but are translated like the rest so the
// dictionary stays whole.
export const orderProblems = defineMessages({
  uz: {
    valueInvalid: "{label} noto‘g‘ri yoki chegaradan tashqari",
    valuePrecision: "{label} aniqligi noto‘g‘ri",
    valuePositive: "{label} musbat bo‘lishi kerak",
    valueMissing: "{label} mavjud emas",
    valueOutOfRange: "{label} chegaradan tashqari",
    oldPriceInvalid: "Eski narx noto‘g‘ri",
    stockUnitMissing: "Ombor birligi ko‘rsatilmagan",
    imageUrlMismatch: "Rasm manzili yuklangan faylga mos kelmadi",
    imageIdWithoutUrl: "Rasm identifikatori manzilsiz yuborildi",
    productNotFound: "Mahsulot topilmadi",
    productUnavailable: "\"{name}\" hozir sotuvda yo‘q. Uni savatdan olib tashlang.",
    quantityAndAmount: "Miqdor va summa bir vaqtda yuborilmaydi",
    amountInQuantityMode: "Miqdor rejimida summa yuborilmaydi",
    quantityInAmountMode: "Summa rejimida miqdor yuborilmaydi",
    amountModeUnits: "Summa rejimi faqat kg yoki litr uchun mavjud",
    mixedModes: "Bir mahsulot uchun rejimlar aralashtirilmasin",
    quantityRequired: "Miqdor ko‘rsatilishi kerak",
    wholeUnits: "Dona va qadoq miqdori butun musbat son bo‘lishi kerak",
    orderValueOutOfRange: "Buyurtma qiymati chegaradan tashqari",
    amountRequired: "Summa ko‘rsatilishi kerak",
    amountTooSmall: "Summa bo‘yicha miqdor juda kichik",
    quantityMinimum: "Miqdor kamida 0.001 bo‘lishi kerak",
    notEnoughStock: "Omborda yetarli mahsulot yo‘q",
    orderSumOutOfRange: "Buyurtma summasi chegaradan tashqari",
    orderTotalOutOfRange: "Buyurtma jami chegaradan tashqari",
  },
  ru: {
    valueInvalid: "{label}: неверное значение или выход за допустимые пределы",
    valuePrecision: "{label}: слишком много знаков после запятой",
    valuePositive: "{label}: значение должно быть положительным",
    valueMissing: "{label}: значение отсутствует",
    valueOutOfRange: "{label}: выход за допустимые пределы",
    oldPriceInvalid: "Неверная старая цена",
    stockUnitMissing: "Не указана единица измерения остатка",
    imageUrlMismatch: "Адрес изображения не совпадает с загруженным файлом",
    imageIdWithoutUrl: "Идентификатор изображения отправлен без адреса",
    productNotFound: "Товар не найден",
    productUnavailable: "«{name}» сейчас нет в продаже. Уберите его из корзины.",
    quantityAndAmount: "Нельзя указать количество и сумму одновременно",
    amountInQuantityMode: "При покупке по количеству сумма не указывается",
    quantityInAmountMode: "При покупке на сумму количество не указывается",
    amountModeUnits: "Покупка на сумму доступна только для кг и литров",
    mixedModes: "Для одного товара нельзя смешивать способы покупки",
    quantityRequired: "Укажите количество",
    wholeUnits: "Количество штук и упаковок должно быть целым положительным числом",
    orderValueOutOfRange: "Объём заказа вне допустимых пределов",
    amountRequired: "Укажите сумму",
    amountTooSmall: "Сумма слишком мала для этого товара",
    quantityMinimum: "Количество должно быть не меньше 0.001",
    notEnoughStock: "Недостаточно товара на складе",
    orderSumOutOfRange: "Сумма заказа вне допустимых пределов",
    orderTotalOutOfRange: "Итог заказа вне допустимых пределов",
  },
  en: {
    valueInvalid: "{label} is invalid or out of range",
    valuePrecision: "{label} has too many decimal places",
    valuePositive: "{label} must be positive",
    valueMissing: "{label} is missing",
    valueOutOfRange: "{label} is out of range",
    oldPriceInvalid: "Invalid old price",
    stockUnitMissing: "The stock unit is not specified",
    imageUrlMismatch: "The image address does not match the uploaded file",
    imageIdWithoutUrl: "An image id was sent without an address",
    productNotFound: "Product not found",
    productUnavailable: "\"{name}\" is no longer for sale. Please remove it from your cart.",
    quantityAndAmount: "Quantity and amount cannot be sent together",
    amountInQuantityMode: "An amount cannot be sent when buying by quantity",
    quantityInAmountMode: "A quantity cannot be sent when buying by amount",
    amountModeUnits: "Buying by amount is only available for kg or litres",
    mixedModes: "Do not mix ways of buying for one product",
    quantityRequired: "Please specify a quantity",
    wholeUnits: "Pieces and packs must be a whole positive number",
    orderValueOutOfRange: "The order size is out of range",
    amountRequired: "Please specify an amount",
    amountTooSmall: "The amount is too small for this product",
    quantityMinimum: "Quantity must be at least 0.001",
    notEnoughStock: "Not enough in stock",
    orderSumOutOfRange: "The order amount is out of range",
    orderTotalOutOfRange: "The order total is out of range",
  },
});

export type OrderProblem = keyof typeof orderProblems.uz;

// Why a chosen delivery time cannot be accepted (lib/store-hours.ts).
export const scheduleMessages = defineMessages({
  uz: {
    invalidTime: "Yetkazish vaqti noto‘g‘ri",
    notAccepting: "Hozir buyurtma qabul qilinmayapti",
    offGrid: "Yetkazish vaqtini ro‘yxatdan tanlang",
    passed: "Bu vaqt o‘tib ketdi, boshqa vaqtni tanlang",
    tooFar: "Faqat {days} kun oldinga buyurtma berish mumkin",
    outsideHours: "Yetkazish faqat ish vaqtida: {open}–{close}",
  },
  ru: {
    invalidTime: "Неверное время доставки",
    notAccepting: "Сейчас заказы не принимаются",
    offGrid: "Выберите время доставки из списка",
    passed: "Это время уже прошло, выберите другое",
    tooFar: "Заказать можно не более чем на {days} дня вперёд",
    outsideHours: "Доставка только в рабочие часы: {open}–{close}",
  },
  en: {
    invalidTime: "Invalid delivery time",
    notAccepting: "We are not taking orders right now",
    offGrid: "Please choose a delivery time from the list",
    passed: "That time has passed, please choose another",
    tooFar: "You can order at most {days} days ahead",
    outsideHours: "Delivery only during opening hours: {open}–{close}",
  },
});

export type ScheduleProblem = keyof typeof scheduleMessages.uz;

// The chat with the shop in the Mini App.
// The weekly leaderboard customers see on their profile.
export const leaderboardMessages = defineMessages({
  uz: { prize: "Maxsus sovg‘a", noName: "Ism kiritilmagan", unknownPhone: "Noma’lum" },
  ru: { prize: "Особый подарок", noName: "Имя не указано", unknownPhone: "Неизвестно" },
  en: { prize: "Special gift", noName: "No name yet", unknownPhone: "Unknown" },
});

export const chatMessages = defineMessages({
  uz: {
    closed: "Chat do‘konning Telegram botida ishlaydi. Do‘konni Telegram orqali oching.",
    tooManyThreads: "Juda ko‘p suhbat ochildi. Biroz kuting.",
    threadNotFound: "Suhbat topilmadi",
    tooManyMessages: "Juda ko‘p xabar yuborildi. Biroz kuting.",
  },
  ru: {
    closed: "Чат работает в Telegram-боте магазина. Откройте магазин через Telegram.",
    tooManyThreads: "Открыто слишком много чатов. Подождите немного.",
    threadNotFound: "Чат не найден",
    tooManyMessages: "Слишком много сообщений. Подождите немного.",
  },
  en: {
    closed: "The chat works in the shop's Telegram bot. Please open the shop through Telegram.",
    tooManyThreads: "Too many chats opened. Please wait a moment.",
    threadNotFound: "Conversation not found",
    tooManyMessages: "Too many messages sent. Please wait a moment.",
  },
});

// What the bot writes to customers in their own chat with it (lib/telegram.ts).
// HTML as Telegram reads it; transliteration leaves the tags alone.
export const botMessages = defineMessages({
  uz: {
    welcomeTitle: "🛒 <b>Q express'ga xush kelibsiz!</b>",
    welcomeTagline: "Qorasuvda oziq-ovqat eshigingizgacha.",
    welcomeSpeed: "⚡ <b>15–19 daqiqada</b> yetkazamiz",
    welcomeHours: "🕕 Ish vaqti: <b>{open}–{close}</b>, yopiq paytda oldindan buyurtma bering",
    welcomeFreeDelivery: "🎁 <b>Har bir xonadonga birinchi yetkazish bepul</b>",
    welcomePayment: "💵 Naqd, Click, Payme, Uzcard yoki Humo",
    welcomeDeals: "🔥 <b>Bugungi chegirmalar</b>",
    welcomeHint: "👇 Pastdagi tugmani bosing, do‘kon shu yerning o‘zida ochiladi",
    currency: "so‘m",
    buttonOpenShop: "🛒 Do‘konni ochish",
    buttonDeals: "🔥 Chegirmalar",
    buttonOrders: "📦 Buyurtmalarim",
    buttonOpenChat: "💬 Chatni ochish",
    menuButton: "Do‘kon",
    replyTitle: "💬 <b>Q express javobi</b>",
    replyHint: "<i>✍️ Javob yozish uchun shu yerga yozing</i>",
    echoTitle: "✉️ <b>Siz yozdingiz</b>",
    noticeBlocked: "⛔️ Hisobingiz do‘kon tomonidan bloklangan. Buyurtma berish va yozish imkoni yo‘q.",
    noticeUnsupported: "ℹ️ Faqat matnli xabar qabul qilinadi ({max} belgigacha).",
    noticeTooMany: "⏳ Juda ko‘p xabar yuborildi. Bir daqiqadan keyin yozing.",
  },
  ru: {
    welcomeTitle: "🛒 <b>Добро пожаловать в Q express!</b>",
    welcomeTagline: "Продукты с доставкой до двери в Карасу.",
    welcomeSpeed: "⚡ Доставим за <b>15–19 минут</b>",
    welcomeHours: "🕕 Часы работы: <b>{open}–{close}</b>, в нерабочее время оформите предзаказ",
    welcomeFreeDelivery: "🎁 <b>Первая доставка в каждую квартиру бесплатно</b>",
    welcomePayment: "💵 Наличные, Click, Payme, Uzcard или Humo",
    welcomeDeals: "🔥 <b>Скидки дня</b>",
    welcomeHint: "👇 Нажмите кнопку ниже — магазин откроется прямо здесь",
    currency: "сум",
    buttonOpenShop: "🛒 Открыть магазин",
    buttonDeals: "🔥 Скидки",
    buttonOrders: "📦 Мои заказы",
    buttonOpenChat: "💬 Открыть чат",
    menuButton: "Магазин",
    replyTitle: "💬 <b>Ответ Q express</b>",
    replyHint: "<i>✍️ Чтобы ответить, напишите сюда</i>",
    echoTitle: "✉️ <b>Вы написали</b>",
    noticeBlocked: "⛔️ Ваш аккаунт заблокирован магазином. Оформлять заказы и писать сообщения нельзя.",
    noticeUnsupported: "ℹ️ Принимаются только текстовые сообщения (до {max} символов).",
    noticeTooMany: "⏳ Слишком много сообщений. Напишите через минуту.",
  },
  en: {
    welcomeTitle: "🛒 <b>Welcome to Q express!</b>",
    welcomeTagline: "Groceries delivered to your door in Qorasuv.",
    welcomeSpeed: "⚡ Delivered in <b>15–19 minutes</b>",
    welcomeHours: "🕕 Opening hours: <b>{open}–{close}</b>; when we are closed, order ahead",
    welcomeFreeDelivery: "🎁 <b>The first delivery to every home is free</b>",
    welcomePayment: "💵 Cash, Click, Payme, Uzcard or Humo",
    welcomeDeals: "🔥 <b>Today's deals</b>",
    welcomeHint: "👇 Tap the button below and the shop opens right here",
    currency: "UZS",
    buttonOpenShop: "🛒 Open the shop",
    buttonDeals: "🔥 Deals",
    buttonOrders: "📦 My orders",
    buttonOpenChat: "💬 Open the chat",
    menuButton: "Shop",
    replyTitle: "💬 <b>Reply from Q express</b>",
    replyHint: "<i>✍️ To reply, just write here</i>",
    echoTitle: "✉️ <b>You wrote</b>",
    noticeBlocked: "⛔️ Your account has been blocked by the shop. You cannot place orders or send messages.",
    noticeUnsupported: "ℹ️ Only text messages are accepted (up to {max} characters).",
    noticeTooMany: "⏳ Too many messages. Please write again in a minute.",
  },
});
