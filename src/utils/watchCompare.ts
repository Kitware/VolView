import {
  WatchCallback,
  WatchOptions,
  WatchSource,
  WatchStopHandle,
  watch,
} from 'vue';

export interface WatchCompareOptions<
  Immediate,
> extends WatchOptions<Immediate> {
  compare: (a: any, b: any) => boolean;
}

// Internal Types from vue
export type MultiWatchSources = (WatchSource<unknown> | object)[];

export type MapSources<T> = {
  [K in keyof T]: T[K] extends WatchSource<infer V> ? V : never;
};
export type MapOldSources<T, Immediate> = {
  [K in keyof T]: T[K] extends WatchSource<infer V>
    ? Immediate extends true
      ? V | undefined
      : V
    : never;
};

// overloads
export function watchCompare<
  T extends Readonly<WatchSource<unknown>[]>,
  Immediate extends Readonly<boolean> = false,
>(
  sources: [...T],
  cb: WatchCallback<MapSources<T>, MapOldSources<T, Immediate>>,
  options?: WatchCompareOptions<Immediate>
): WatchStopHandle;
export function watchCompare<T, Immediate extends Readonly<boolean> = false>(
  source: WatchSource<T>,
  cb: WatchCallback<T, Immediate extends true ? T | undefined : T>,
  options?: WatchCompareOptions<Immediate>
): WatchStopHandle;
export function watchCompare<
  T extends object,
  Immediate extends Readonly<boolean> = false,
>(
  source: T,
  cb: WatchCallback<T, Immediate extends true ? T | undefined : T>,
  options?: WatchCompareOptions<Immediate>
): WatchStopHandle;

export function watchCompare<Immediate extends Readonly<boolean> = false>(
  sources: any,
  callback: any,
  options?: WatchCompareOptions<Immediate>
): WatchStopHandle {
  return watch(
    sources,
    (newData, oldData, onCleanup) => {
      let cleanupFn: (() => void) | null = null;
      const innerOnCleanup = (fn: () => void) => {
        cleanupFn = fn;
      };
      const changed = options?.compare(newData, oldData);

      onCleanup(() => {
        if (!changed) return;
        cleanupFn?.();
      });

      if (changed) return;
      callback(newData, oldData, innerOnCleanup);
    },
    options
  );
}
