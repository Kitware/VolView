import { PiniaPluginContext, StoreGeneric } from 'pinia';

const stores = new Map<string, StoreGeneric>();

/**
 * Gets a pinia store by it's ID.
 *
 * Assumes the store has already been initialized via useStore.
 * @param id
 * @returns
 */
export function getPiniaStore(id: string) {
  return stores.get(id);
}

export function StoreRegistry(context: PiniaPluginContext) {
  const { store } = context;
  stores.set(store.$id, store);
}
