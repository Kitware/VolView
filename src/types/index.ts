import { StoreDefinition } from 'pinia';

export type Maybe<T> = T | null | undefined;

export type NullableValues<T> = {
  [K in keyof T]: T[K] | null;
};

export type PiniaStoreState<S extends StoreDefinition> =
  ReturnType<S>['$state'];

export type SampleDataset = {
  name: string;
  filename: string;
  description: string;
  url: string;
  image: string;
};

export type RequiredWithPartial<T, K extends keyof T> = Required<Omit<T, K>> &
  Partial<Pick<T, K>>;

export type PartialWithRequired<T, K extends keyof T> = Pick<T, K> &
  Partial<Omit<T, K>>;

export type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;

export type TypedArrayConstructor =
  | Uint8ArrayConstructor
  | Uint8ClampedArrayConstructor
  | Uint16ArrayConstructor
  | Uint32ArrayConstructor
  | Int8ArrayConstructor
  | Int16ArrayConstructor
  | Int32ArrayConstructor
  | Float32ArrayConstructor
  | Float64ArrayConstructor;
