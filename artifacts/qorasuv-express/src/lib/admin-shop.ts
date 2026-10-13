import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAdminSessionQueryKey,
  getListAdminShopsQueryKey,
  useGetAdminSession,
  useListAdminShops,
} from '@workspace/api-client-react';
import { PLATFORM_SHOP_ID } from './shop';

// The shop the dashboard works in. Every admin works in their own shop; a
// super admin of Q express (the platform) may switch to any shop, and every
// admin request then names it in X-Admin-Shop (see main.tsx). The choice is
// kept per browser tab (sessionStorage): a choice shared between tabs would
// let a tab still showing one shop send its changes to another.

const ACTING_SHOP_KEY = 'qorasuv-admin-shop';

export function storedActingShopId(): number | undefined {
  try {
    const value = Number(sessionStorage.getItem(ACTING_SHOP_KEY));
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

// Every component showing the acting shop re-renders when it changes.
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function storeActingShopId(id: number | undefined) {
  try {
    if (id === undefined) sessionStorage.removeItem(ACTING_SHOP_KEY);
    else sessionStorage.setItem(ACTING_SHOP_KEY, String(id));
  } catch {
    // Storage may be unavailable; the dashboard then stays in the admin's shop.
  }
  listeners.forEach(listener => listener());
}

// Forms with edits not yet saved (a shop's card, its hours). Moving to another
// shop would throw them away, so the shop switcher asks first.
const unsavedWork = new Set<string>();

export function useUnsavedWork(key: string, dirty: boolean) {
  useEffect(() => {
    if (dirty) unsavedWork.add(key);
    else unsavedWork.delete(key);
    return () => {
      unsavedWork.delete(key);
    };
  }, [key, dirty]);
}

export function hasUnsavedWork() {
  return unsavedWork.size > 0;
}

export function forgetActingShop() {
  storeActingShopId(undefined);
}

// What main.tsx sends with every admin request. The server ignores it for
// anyone but a platform super admin, so a stale value is harmless.
export function actingShopHeader(): Record<string, string> {
  const id = storedActingShopId();
  return id ? { 'x-admin-shop': String(id) } : {};
}

export function useAdminShop() {
  const qc = useQueryClient();
  const session = useGetAdminSession({ query: { queryKey: getGetAdminSessionQueryKey(), retry: false } });
  const admin = session.data?.authenticated ? session.data.admin : undefined;
  const shops = useListAdminShops({ query: { queryKey: getListAdminShopsQueryKey(), enabled: Boolean(admin) } });
  const platformSuper = Boolean(admin?.platform_super_admin);
  const ownShopId = admin?.shop_id;
  const storedId = useSyncExternalStore(subscribe, storedActingShopId, storedActingShopId);
  const stored = platformSuper ? storedId : undefined;
  const list = shops.data ?? [];
  const actingId = stored && list.some(shop => shop.id === stored) ? stored : ownShopId;
  const acting = list.find(shop => shop.id === actingId);

  // Moving to another shop drops every admin query but the session and the
  // shop list, so nothing of the previous shop stays on screen.
  const switchTo = (id: number) => {
    storeActingShopId(id === ownShopId ? undefined : id);
    qc.removeQueries({
      predicate: query => {
        const key = String(query.queryKey[0]);
        return key.startsWith('/api/admin/') && key !== '/api/admin/session' && key !== '/api/admin/shops';
      },
    });
    // Pages still on screen read again, now in the new shop.
    void qc.invalidateQueries({
      predicate: query => {
        const key = String(query.queryKey[0]);
        return key.startsWith('/api/admin/') && key !== '/api/admin/session';
      },
    });
  };

  return {
    admin,
    shops: list,
    acting,
    actingId,
    // A Q express admin: sees every shop and may edit any shop's card.
    platformAdmin: ownShopId === PLATFORM_SHOP_ID,
    platformSuper,
    inOwnShop: actingId === ownShopId,
    switchTo,
  };
}
