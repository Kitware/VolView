import { VtkObjectConstructor } from '@/src/core/vtk/types';
import { vtkFieldRef } from '@/src/core/vtk/vtkFieldRef';
import { Maybe } from '@/src/types';
import { vtkAlgorithm, vtkObject } from '@kitware/vtk.js/interfaces';
import { computedWithControl } from '@vueuse/core';
import { ComputedRef, MaybeRef, onScopeDispose, unref, watchEffect } from 'vue';

export function useVtkFilter<T extends vtkAlgorithm & vtkObject>(
  filterClass: VtkObjectConstructor<T>,
  ...inputData: MaybeRef<Maybe<vtkObject>>[]
) {
  const filter = filterClass.newInstance();
  const mtime = vtkFieldRef(filter as vtkObject, 'mTime');

  watchEffect(() => {
    inputData
      .map((input) => unref(input))
      .forEach((input, port) => {
        if (input) filter.setInputData(unref(input), port);
      });
  });

  let cache: Record<number, ComputedRef<any>> = {};

  const getOutputData = <D>(port = 0) => {
    if (!(port in cache)) {
      cache[port] = computedWithControl(mtime, () => {
        if (!filter.getInputData(port)) return null;
        return filter.getOutputData(port) as D;
      });
    }
    return cache[port] as ComputedRef<D>;
  };

  onScopeDispose(() => {
    cache = {};
    filter.delete();
  });

  return { filter, getOutputData };
}
