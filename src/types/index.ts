import { StoreDefinition } from 'pinia';

export type NullableValues<T> = {
  [K in keyof T]: T[K] | null;
};

export type PiniaStoreState<S extends StoreDefinition> =
  ReturnType<S>['$state'];
