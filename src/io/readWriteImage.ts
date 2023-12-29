import vtkITKHelper from '@kitware/vtk.js/Common/DataModel/ITKHelper';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { copyImage } from 'itk-wasm';
import {
  readImage as readImageItk,
  writeImage as writeImageItk,
} from '@itk-wasm/image-io';
import { vtiReader, vtiWriter } from '@/src/io/vtk/async';

export const readImage = async (file: File) => {
  if (file.name.endsWith('.vti'))
    return (await vtiReader(file)) as vtkImageData;

  const { image, webWorker } = await readImageItk(null, file);
  webWorker.terminate();
  return vtkITKHelper.convertItkToVtkImage(image);
};

export const writeImage = async (format: string, image: vtkImageData) => {
  if (format === 'vti') {
    return vtiWriter(image);
  }
  // copyImage so writeImage does not detach live data when passing to worker
  const itkImage = copyImage(vtkITKHelper.convertVtkToItkImage(image));

  // Transpose the direction matrix to fix bug in @itk-wasm/image-io.writeImage
  // Remove when @itk-wasm/image-io version is above 0.5.0 https://github.com/InsightSoftwareConsortium/itk-wasm/commit/ad9ca85eedc47c9d3444cf36859569c529886bde
  const oldDirection = [...itkImage.direction];
  const { dimension } = itkImage.imageType;
  for (let idx = 0; idx < dimension; ++idx) {
    for (let idy = 0; idy < dimension; ++idy) {
      itkImage.direction[idx + idy * dimension] =
        oldDirection[idy + idx * dimension];
    }
  }

  const result = await writeImageItk(null, itkImage, `image.${format}`);
  result.webWorker?.terminate();
  return result.serializedImage.data;
};
