import { defineStore } from 'pinia';
import vtkITKHelper from '@kitware/vtk.js/Common/DataModel/ITKHelper';
import { TypedArray } from '@kitware/vtk.js/types';
import { morphologicalContourInterpolation } from '@itk-wasm/morphological-contour-interpolation';
import type { ProcessTarget } from '@/src/store/tools/paintProcess';

export const useFillBetweenStore = defineStore('fillBetween', () => {
  async function computeAlgorithm({
    segImage,
    labelValue,
  }: ProcessTarget): Promise<TypedArray> {
    const vtkImage = vtkITKHelper.convertVtkToItkImage(segImage);
    const out = await morphologicalContourInterpolation(vtkImage, {
      label: labelValue,
    });

    const vtkOut = vtkITKHelper.convertItkToVtkImage(out.outputImage);
    const outputScalars = vtkOut.getPointData().getScalars();

    return outputScalars.getData() as TypedArray;
  }

  return {
    computeAlgorithm,
  };
});
