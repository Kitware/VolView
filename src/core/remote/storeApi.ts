import { getPiniaStore } from '@/src/plugins/storeRegistry';

type PropKey = number | string;

function getStoreProperty<T = unknown>(
  storeName: string,
  propPath: PropKey[]
): T {
  const store = getPiniaStore(storeName);
  if (!store) {
    throw new Error(`${storeName} does not exist or is not initialized`);
  }

  let value: any = store;
  while (propPath.length) {
    const prop = propPath.shift()! as string;
    value = value[prop];
  }
  return value as T;
}

async function callStoreMethod(
  storeName: string,
  propPath: PropKey[],
  args: unknown[]
) {
  const method = getStoreProperty<(...args: any[]) => any>(storeName, propPath);
  return method(...args);
}

export const StoreApi = {
  getStoreProperty,
  callStoreMethod,
};
