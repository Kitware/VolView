import { Image } from 'itk-wasm';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkITKHelper from '@kitware/vtk.js/Common/DataModel/ITKHelper';
import { compareImageSpaces } from '@/src/utils/imageSpace';
import { runWasm } from './itkWasmUtils';


export async function resample(fixed: Image, moving: Image, label = false) {
  const labelFlag = label ? ['--label'] : [];
  const { size, spacing, origin, direction } = fixed;
  const args = [
    ...labelFlag,
    '--size',
    size.join(','),
    '--spacing',
    spacing.join(','),
    '--origin',
    origin.join(','),
    '--direction',
    direction.join(','),
  ];

  return runWasm('resample', args, [moving]);
}

export async function ensureSameSpace(target: vtkImageData, resampleCandidate: vtkImageData, label = false) {
  if (compareImageSpaces(target, resampleCandidate)) {
    return resampleCandidate; // could still be different pixel dimensions
  } 
  const itkImage = await resample(
    vtkITKHelper.convertVtkToItkImage(target),
    vtkITKHelper.convertVtkToItkImage(resampleCandidate),
    label
  );
  return vtkITKHelper.convertItkToVtkImage(itkImage);
}