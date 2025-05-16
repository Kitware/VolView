import { Maybe } from '../types';

export type DoubleKeyRecord<V> = Record<string, Record<string, V>>;

/* eslint-disable no-param-reassign */

export function patchDoubleKeyRecord<V>(
  record: DoubleKeyRecord<V>,
  k1: string,
  k2: string,
  patch: Partial<V>
) {
  if (!(k1 in record)) {
    record[k1] = {};
  }

  // triggers shallow record[k1][k2] watchers
  record[k1][k2] = {
    ...record[k1][k2],
    ...patch,
  };
}

export function deleteSecondKey<V>(record: DoubleKeyRecord<V>, k2: string) {
  Object.keys(record).forEach((k1) => {
    delete record[k1][k2];
  });
}

export function deleteFirstKey<V>(record: DoubleKeyRecord<V>, k1: string) {
  delete record[k1];
}

export function deleteEntry<V>(
  record: DoubleKeyRecord<V>,
  k1: string,
  k2: string
) {
  if (record[k1]) {
    delete record[k1][k2];
  }
}

/* eslint-enable no-param-reassign */

export function getDoubleKeyRecord<V>(
  record: DoubleKeyRecord<V>,
  k1: Maybe<string>,
  k2: Maybe<string>
): Maybe<V> {
  if (k1 == null || k2 == null) return null;
  return record[k1]?.[k2];
}
