import { StoreDefinition } from 'pinia';

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
  volumeKey?: string;
};
