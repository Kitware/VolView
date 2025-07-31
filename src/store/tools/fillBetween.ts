import { defineStore } from 'pinia';
import vtkITKHelper from '@kitware/vtk.js/Common/DataModel/ITKHelper';
import { TypedArray } from '@kitware/vtk.js/types';
import vtkLabelMap from '@/src/vtk/LabelMap';
import { morphologicalContourInterpolation } from '@itk-wasm/morphological-contour-interpolation';

export const useFillBetweenStore = defineStore('fillBetween', () => {
  async function computeAlgorithm(
    segImage: vtkLabelMap,
    activeSegment: number
  ): Promise<TypedArray> {
    const vtkImage = vtkITKHelper.convertVtkToItkImage(segImage);
    const out = await morphologicalContourInterpolation(vtkImage, {
      label: activeSegment,
    });

    const vtkOut = vtkITKHelper.convertItkToVtkImage(out.outputImage);
    const outputScalars = vtkOut.getPointData().getScalars();

    return outputScalars.getData() as TypedArray;
  }

  return {
    computeAlgorithm,
  };
});
