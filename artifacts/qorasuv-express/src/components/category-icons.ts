import {
  Apple, Baby, Beef, Boxes, Candy, Carrot, Coffee, Cookie, Croissant, CupSoda, Drumstick, Egg, Fish, Hand,
  Leaf, Milk, Package, ShoppingBasket, Snowflake, Sparkles, SprayCan, Store, Tag, WalletCards, Wheat,
} from 'lucide-react';

// The names a category may store in its icon column. The seed catalog uses the
// first eight; an admin picks from the whole list.
export const CATEGORY_ICONS = [
  { name: 'leaf', label: 'Meva-sabzavot', Icon: Leaf },
  { name: 'milk', label: 'Sut', Icon: Milk },
  { name: 'wheat', label: 'Non', Icon: Wheat },
  { name: 'beef', label: 'Go‘sht', Icon: Beef },
  { name: 'cup', label: 'Ichimlik', Icon: CupSoda },
  { name: 'cookie', label: 'Shirinlik', Icon: Cookie },
  { name: 'sparkles', label: 'Maishiy', Icon: Sparkles },
  { name: 'hand', label: 'Gigiyena', Icon: Hand },
  { name: 'apple', label: 'Meva', Icon: Apple },
  { name: 'carrot', label: 'Sabzavot', Icon: Carrot },
  { name: 'croissant', label: 'Pishiriq', Icon: Croissant },
  { name: 'drumstick', label: 'Tovuq', Icon: Drumstick },
  { name: 'fish', label: 'Baliq', Icon: Fish },
  { name: 'egg', label: 'Tuxum', Icon: Egg },
  { name: 'snowflake', label: 'Muzlatilgan', Icon: Snowflake },
  { name: 'coffee', label: 'Choy-qahva', Icon: Coffee },
  { name: 'candy', label: 'Konfet', Icon: Candy },
  { name: 'baby', label: 'Bolalar', Icon: Baby },
  { name: 'spray', label: 'Tozalash', Icon: SprayCan },
  { name: 'package', label: 'Qadoqli', Icon: Package },
  { name: 'basket', label: 'Boshqa', Icon: ShoppingBasket },
] as const;

const byName = new Map<string, (typeof CATEGORY_ICONS)[number]['Icon']>(CATEGORY_ICONS.map(icon => [icon.name, icon.Icon]));

// A category whose icon is not one of the names above (typed by hand in an
// older build) still gets an icon, the one its place in the list picks.
const FALLBACK = [ShoppingBasket, Tag, Boxes, Sparkles, Store, WalletCards];

export function categoryIcon(name: string, index = 0) {
  const place = ((index % FALLBACK.length) + FALLBACK.length) % FALLBACK.length;
  return byName.get(name) ?? FALLBACK[place];
}
