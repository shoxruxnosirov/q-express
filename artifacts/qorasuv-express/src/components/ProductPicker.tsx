import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useCart, CartLine } from '@/lib/cart';
import { Product } from '@workspace/api-client-react';

import { useT } from '@/i18n';
import messages from '@/i18n/messages/productPicker';
import { unitLabel } from '@/i18n/messages/units';

export function ProductPicker() {
  const { pickerProduct, closePicker, lines, setLine, remove } = useCart();
  if (!pickerProduct) return null;
  const existing = lines.find(l => l.productId === pickerProduct.id);
  
  return (
    <ProductPickerContent 
      key={pickerProduct.id} 
      product={pickerProduct} 
      existing={existing} 
      onClose={closePicker} 
      onSave={setLine} 
      onRemove={() => remove(pickerProduct.id)} 
    />
  );
}

function ProductPickerContent({ 
  product, 
  existing, 
  onClose, 
  onSave, 
  onRemove 
}: { 
  product: Product; 
  existing?: CartLine; 
  onClose: () => void; 
  onSave: (line: CartLine) => void; 
  onRemove: () => void; 
}) {
  const { t, money, script, lang } = useT(messages);
  const unit = unitLabel(product.unit, lang);
  const isKg = product.unit === 'kg';
  const isLitr = product.unit === 'litr';
  const isContinuous = isKg || isLitr;

  const [mode, setMode] = useState<'quantity' | 'amount'>(existing?.purchaseMode || 'quantity');
  
  const [qtyUnit, setQtyUnit] = useState<'main' | 'sub'>('main');
  const [qtyVal, setQtyVal] = useState(
    existing?.purchaseMode === 'quantity' 
      ? (qtyUnit === 'sub' ? String(Number((existing.quantity * 1000).toFixed(0))) : String(existing.quantity)) 
      : (isContinuous ? '0.5' : '1')
  );

  const [amountVal, setAmountVal] = useState(
    existing?.purchaseMode === 'amount' ? String(existing.amount) : ''
  );

  const parsedQty = parseFloat(qtyVal);
  const finalQty = isContinuous && qtyUnit === 'sub' ? Number((parsedQty / 1000).toFixed(3)) : parsedQty;
  const parsedAmount = parseFloat(amountVal);

  const isQtyStepValid = isContinuous 
    ? Math.abs(Math.round(finalQty * 1000) - finalQty * 1000) < 0.000001 
    : Number.isInteger(finalQty);

  const isValidQty = Number.isFinite(finalQty) && 
                     finalQty >= (isContinuous ? 0.001 : 1) && 
                     finalQty <= product.stock && 
                     isQtyStepValid;
                     
  const exactAmountForQty = isValidQty ? Number((finalQty * product.price).toFixed(2)) : 0;

  const isAmountStepValid = Math.abs(Math.round(parsedAmount * 100) - parsedAmount * 100) < 0.000001;
  const approxQtyForAmount = Number.isFinite(parsedAmount) && parsedAmount > 0 && product.price > 0
    ? Number((parsedAmount / product.price).toFixed(6)) 
    : 0;

  const isValidAmount = Number.isFinite(parsedAmount) && 
                        parsedAmount > 0 && 
                        isAmountStepValid && 
                        approxQtyForAmount >= 0.001 && 
                        approxQtyForAmount <= product.stock;

  const handleSave = () => {
    if (mode === 'quantity' && isValidQty) {
       onSave({
         productId: product.id,
         product,
         purchaseMode: 'quantity',
         quantity: Number(finalQty.toFixed(3)),
       });
       onClose();
    } else if (mode === 'amount' && isValidAmount) {
       onSave({
         productId: product.id,
         product,
         purchaseMode: 'amount',
         quantity: approxQtyForAmount,
         amount: parsedAmount
       });
       onClose();
    }
  };

  const modalRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const focusable = modalRef.current?.querySelectorAll('input, button, select');
        if (focusable && focusable.length > 0) {
          const first = focusable[0] as HTMLElement;
          const last = focusable[focusable.length - 1] as HTMLElement;
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    
    // On a phone, focusing the field opens the keyboard at once, and the
    // keyboard squeezes the sheet into a small scrolling box before the
    // customer has seen it. There the sheet itself takes focus, and the field
    // waits for a tap; with a mouse and keyboard the field is focused.
    const touch = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    const inputs = modalRef.current?.querySelectorAll('input');
    const target = !touch && inputs && inputs.length > 0 ? inputs[0] as HTMLElement : modalRef.current;
    setTimeout(() => target?.focus({ preventScroll: true }), 10);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[hsl(var(--foreground)/.4)] backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div 
        ref={modalRef}
        role="dialog" 
        aria-modal="true" 
        aria-labelledby="picker-title"
        className="w-full max-w-md max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] overflow-y-auto overscroll-contain rounded-t-[24px] bg-[hsl(var(--card))] p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] outline-none sm:rounded-[24px] shadow-2xl animate-rise"
        onClick={e => e.stopPropagation()}
        tabIndex={-1}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 id="picker-title" className="display text-xl font-bold">{script(product.name)}</h3>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">1 {unit} = {money(product.price)}</p>
          </div>
          <button data-testid="button-picker-close" aria-label={t('close')} onClick={onClose} className="rounded-full p-2 hover:bg-[hsl(var(--muted))] transition"><X size={18} /></button>
        </div>
        
        {isContinuous && (
          <div className="mb-5 flex rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.5)] p-1">
            <button data-testid="tab-picker-quantity" aria-pressed={mode === 'quantity'} className={`flex-1 rounded-lg py-2.5 text-sm font-bold transition ${mode === 'quantity' ? 'bg-[hsl(var(--card))] shadow-sm text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'}`} onClick={() => setMode('quantity')}>{isKg ? t('byWeight') : t('byVolume')}</button>
            <button data-testid="tab-picker-amount" aria-pressed={mode === 'amount'} className={`flex-1 rounded-lg py-2.5 text-sm font-bold transition ${mode === 'amount' ? 'bg-[hsl(var(--card))] shadow-sm text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'}`} onClick={() => setMode('amount')}>{t('byMoney')}</button>
          </div>
        )}
        
        {mode === 'quantity' ? (
          <div className="space-y-4">
            <div className="flex gap-2">
              <input aria-label={t('quantityLabel')} data-testid="input-picker-quantity" type="number" step={isContinuous ? (qtyUnit === 'sub' ? '100' : '0.001') : '1'} min={isContinuous ? (qtyUnit === 'sub' ? '1' : '0.001') : '1'} value={qtyVal} onChange={e => setQtyVal(e.target.value)} className="h-14 w-full flex-1 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 text-lg font-bold outline-none transition focus:border-[hsl(var(--primary))] focus:ring-4 focus:ring-[hsl(var(--primary)/.1)]" placeholder={t('quantityPlaceholder')} />
              {isContinuous ? (
                <select aria-label={t('unitLabel')} data-testid="select-picker-unit" value={qtyUnit} onChange={e => {
                    const newUnit = e.target.value as 'main' | 'sub';
                    if (newUnit !== qtyUnit && Number.isFinite(parsedQty)) {
                       setQtyVal(newUnit === 'sub' ? String(Number((parsedQty * 1000).toFixed(0))) : String(Number((parsedQty / 1000).toFixed(3))));
                    }
                    setQtyUnit(newUnit);
                }} className="h-14 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 font-bold outline-none">
                  <option value="main">{unit}</option>
                  <option value="sub">{isKg ? t('gram') : t('millilitre')}</option>
                </select>
              ) : (
                <div className="flex h-14 items-center rounded-xl bg-[hsl(var(--muted))] px-4 font-bold text-[hsl(var(--muted-foreground))]">{unit}</div>
              )}
            </div>
            {isValidQty ? <p data-testid="text-picker-total" className="text-sm font-semibold text-[hsl(var(--primary))]">{t('total', { sum: money(exactAmountForQty) })}</p> : (qtyVal !== '' && <p data-testid="text-picker-error" className="text-sm text-[hsl(var(--destructive))]">{t('quantityError', { stock: product.stock, unit })}</p>)}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="relative">
              <input aria-label={t('amountLabel')} data-testid="input-picker-amount" type="number" step="100" min="100" value={amountVal} onChange={e => setAmountVal(e.target.value)} className="h-14 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 pr-16 text-lg font-bold outline-none transition focus:border-[hsl(var(--primary))] focus:ring-4 focus:ring-[hsl(var(--primary)/.1)]" placeholder={t('amountPlaceholder')} />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-[hsl(var(--muted-foreground))]">{t('currency')}</span>
            </div>
            {isValidAmount ? <p data-testid="text-picker-approx" className="text-sm font-semibold text-[hsl(var(--primary))]">{t('approx', { quantity: approxQtyForAmount, unit })}</p> : (amountVal !== '' && <p data-testid="text-picker-error" className="text-sm text-[hsl(var(--destructive))]">{t('amountError')}</p>)}
          </div>
        )}
        
        <div className="mt-7 flex gap-3">
          {existing && <button data-testid="button-picker-remove" onClick={() => { onRemove(); onClose(); }} className="tap h-14 flex-1 rounded-xl border-2 border-[#f8e3de] text-[#a64b3f] font-bold transition hover:bg-[#f8e3de]">{t('remove')}</button>}
          <button data-testid="button-picker-save" onClick={handleSave} disabled={mode === 'quantity' ? !isValidQty : !isValidAmount} className="tap h-14 flex-[2] rounded-xl bg-[hsl(var(--primary))] text-white font-extrabold transition hover:shadow-[0_8px_20px_rgba(22,116,96,.3)] disabled:opacity-50 disabled:shadow-none">{existing ? t('save') : t('add')}</button>
        </div>
      </div>
    </div>
  );
}
