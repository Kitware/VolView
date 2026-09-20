import vtkITKHelper from '@kitware/vtk.js/Common/DataModel/ITKHelper';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { copyImage } from 'itk-wasm';
import {
  readImage as readImageItk,
  writeImage as writeImageItk,
} from '@itk-wasm/image-io';
import { vtiReader, vtiWriter } from '@/src/io/vtk/async';
import { getWorker } from '@/src/io/itk/worker';
import type { LabelmapSegment } from '@/src/segmentation/model';
import { maybeBuildSegNrrdMetadata } from '@/src/io/segNrrdMetadata';
import { repairUnusableSpacing } from '@/src/utils/imageSpace';

export type ReadImageResult = {
  image: vtkImageData;
  headerMetadata?: Map<string, string>;
};

const getHeaderMetadata = (image: { metadata?: Map<string, unknown> }) => {
  const metadata = image.metadata;
  if (!(metadata instanceof Map) || !metadata.size) return undefined;

  const headerMetadata = new Map<string, string>();
  metadata.forEach((value, key) => {
    headerMetadata.set(key, typeof value === 'string' ? value : String(value));
  });
  return headerMetadata;
};

// Repaired like the parent import so a restored labelmap keeps its grid.
export const readImage = async (file: File): Promise<ReadImageResult> => {
  if (file.name.endsWith('.vti')) {
    const image = (await vtiReader(file)) as vtkImageData;
    repairUnusableSpacing(image);
    return { image };
  }

  const { image } = await readImageItk(file, { webWorker: getWorker() });
  const vtkImage = vtkITKHelper.convertItkToVtkImage(image);
  repairUnusableSpacing(vtkImage);
  return {
    image: vtkImage,
    headerMetadata: getHeaderMetadata(image),
  };
};

export const writeImage = async (
  format: string,
  image: vtkImageData,
  metadata?: Map<string, string>
) => {
  if (format === 'vti') {
    return vtiWriter(image);
  }
  // copyImage so writeImage does not detach live data when passing to worker
  const itkImage = copyImage(vtkITKHelper.convertVtkToItkImage(image));

  if (metadata) {
    itkImage.metadata = metadata;
  }

  const result = await writeImageItk(itkImage, `image.${format}`, {
    webWorker: getWorker(),
    useCompression: true,
  });
  return result.serializedImage.data as Uint8Array<ArrayBuffer>;
};

export const writeSegmentation = (
  format: string,
  image: vtkImageData,
  segments: LabelmapSegment[]
) => {
  const metadata = maybeBuildSegNrrdMetadata(
    format,
    segments,
    image.getDimensions() as [number, number, number]
  );
  return writeImage(format, image, metadata);
};
