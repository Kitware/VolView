import { Image } from 'itk-wasm';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkITKHelper from '@kitware/vtk.js/Common/DataModel/ITKHelper';
import { compareImageIndexGrids } from '@/src/utils/imageSpace';
import { shallowCopyImageData } from '@/src/utils/vtk-helpers';
import { runWasm } from './itkWasmUtils';
import { reorientLabelImage } from './reorientLabelImage';

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

export async function ensureSameSpace(
  target: vtkImageData,
  resampleCandidate: vtkImageData,
  label = false
) {
  // Callers own what they get back and may hand it to something that disposes
  // it, so never return the candidate itself.
  if (label) {
    const reoriented = reorientLabelImage(target, resampleCandidate);
    if (reoriented === resampleCandidate)
      return shallowCopyImageData(resampleCandidate);
    if (reoriented) return reoriented;
  } else if (compareImageIndexGrids(target, resampleCandidate)) {
    return shallowCopyImageData(resampleCandidate);
  }
  const itkImage = await resample(
    vtkITKHelper.convertVtkToItkImage(target),
    vtkITKHelper.convertVtkToItkImage(resampleCandidate),
    label
  );
  return vtkITKHelper.convertItkToVtkImage(itkImage);
}
