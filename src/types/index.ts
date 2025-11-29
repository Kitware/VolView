import type { UnwrapRef } from 'vue';

export type Maybe<T> = T | null | undefined;

export type UnwrapAll<T> = { [K in keyof T]: UnwrapRef<T[K]> };

export type NullableValues<T> = {
  [K in keyof T]: T[K] | null;
};

export type SampleDataset = {
  name: string;
  filename: string;
  description: string;
  url: string;
  image: string;
  defaults?: {
    colorPreset?: string;
  };
};

/**
 * Sets certain keys to be required and the rest to optional.
 */
export type RequiredWithPartial<T, K extends keyof T> = Required<Omit<T, K>> &
  Partial<Pick<T, K>>;

/**
 * Sets certain keys to be optional and the rest to required.
 */
export type PartialWithRequired<T, K extends keyof T> = Required<Pick<T, K>> &
  Partial<Omit<T, K>>;

export type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;

export type ValueOf<T> = T[keyof T];

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

export type TypedArrayConstructorName =
  | 'Uint8Array'
  | 'Uint8ClampedArray'
  | 'Uint16Array'
  | 'Uint32Array'
  | 'Int8Array'
  | 'Int16Array'
  | 'Int32Array'
  | 'Float32Array'
  | 'Float64Array';

export type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;

export type FirstParam<T> = T extends (first: infer R, ...args: any[]) => any
  ? R
  : never;

/**
 * The props passed to components when used as part of the LayoutGrid.
 */
export interface LayoutViewProps {
  id: string;
  type: string;
}
