import vtkITKHelper from '@kitware/vtk.js/Common/DataModel/ITKHelper';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { copyImage } from 'itk-wasm';
import {
  readImage as readImageItk,
  writeImage as writeImageItk,
} from '@itk-wasm/image-io';
import { vtiReader, vtiWriter } from '@/src/io/vtk/async';
import { getWorker } from '@/src/io/itk/worker';

export const readImage = async (file: File) => {
  if (file.name.endsWith('.vti'))
    return (await vtiReader(file)) as vtkImageData;

  const { image } = await readImageItk(file, { webWorker: getWorker() });
  return vtkITKHelper.convertItkToVtkImage(image);
};

export const writeImage = async (format: string, image: vtkImageData) => {
  if (format === 'vti') {
    return vtiWriter(image);
  }
  // copyImage so writeImage does not detach live data when passing to worker
  const itkImage = copyImage(vtkITKHelper.convertVtkToItkImage(image));

  const result = await writeImageItk(itkImage, `image.${format}`, {
    webWorker: getWorker(),
  });
  return result.serializedImage.data as Uint8Array<ArrayBuffer>;
};
