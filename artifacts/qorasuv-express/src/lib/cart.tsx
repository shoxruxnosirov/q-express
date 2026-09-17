import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { Product } from '@workspace/api-client-react';

const CART_STORAGE_KEY = 'qorasuv-cart-v2';
const LEGACY_CART_STORAGE_KEY = 'qorasuv-cart';

export type CartLine = {
  productId: number;
  product: Product;
  purchaseMode: 'quantity' | 'amount';
  quantity: number;
  amount?: number;
};

export type CartContextValue = {
  lines: CartLine[];
  count: number;
  subtotal: number;
  setLine: (line: CartLine) => void;
  remove: (productId: number) => void;
  clear: () => void;
  pickerProduct: Product | null;
  openPicker: (product: Product) => void;
  closePicker: () => void;
};

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function isProduct(value: unknown): value is Product {
  if (!value || typeof value !== 'object') return false;
  const product = value as Partial<Product>;
  return Number.isFinite(product.id) && typeof product.name === 'string'
    && typeof product.price === 'number' && Number.isFinite(product.price)
    && typeof product.unit === 'string' && typeof product.stock === 'number';
}

function readStoredLines(raw: string | null, allowLegacy = false): CartLine[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): CartLine[] => {
      if (!item || typeof item !== 'object') return [];
      const value = item as Partial<CartLine> & { product?: unknown };
      if (!isProduct(value.product) || typeof value.productId !== 'number' && !allowLegacy) return [];
      const productId = typeof value.productId === 'number' ? value.productId : value.product.id;
      const quantity = typeof value.quantity === 'number' ? value.quantity : 0;
      if (!Number.isFinite(productId) || !Number.isFinite(quantity) || quantity <= 0) return [];
      const purchaseMode = value.purchaseMode === 'amount' ? 'amount' : 'quantity';
      const amount = typeof value.amount === 'number' && Number.isFinite(value.amount) && value.amount > 0
        ? roundMoney(value.amount) : undefined;
      if (purchaseMode === 'amount' && amount === undefined) return [];
      return [{
        productId,
        product: value.product,
        purchaseMode,
        quantity,
        ...(amount === undefined ? {} : { amount }),
      }];
    });
  } catch {
    return [];
  }
}

const CartContext = createContext<CartContextValue | null>(null);

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error('Cart must be inside CartProvider');
  return context;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pickerProduct, setPickerProduct] = useState<Product | null>(null);

  useEffect(() => {
    try {
      const current = readStoredLines(localStorage.getItem(CART_STORAGE_KEY));
      const legacy = current.length ? [] : readStoredLines(localStorage.getItem(LEGACY_CART_STORAGE_KEY), true);
      setLines(current.length ? current : legacy);
    } catch {
      // ignore
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) {
      try { localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(lines)); } catch { /* storage may be unavailable */ }
    }
  }, [lines, loaded]);

  const value = useMemo(() => ({
    lines,
    count: lines.length,
    subtotal: roundMoney(lines.reduce((sum, line) => sum + roundMoney(line.purchaseMode === 'amount' ? (line.amount || 0) : line.quantity * line.product.price), 0)),
    setLine: (line: CartLine) => setLines(current => {
      const idx = current.findIndex(l => l.productId === line.productId);
      if (idx >= 0) {
        const copy = [...current];
        copy[idx] = line;
        return copy;
      }
      return [...current, line];
    }),
    remove: (id: number) => setLines(current => current.filter(l => l.productId !== id)),
    clear: () => setLines([]),
    pickerProduct,
    openPicker: setPickerProduct,
    closePicker: () => setPickerProduct(null)
  }), [lines, pickerProduct]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
