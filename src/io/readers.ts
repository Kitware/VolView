import { convertItkToVtkImage } from '@kitware/vtk.js/Common/DataModel/ITKHelper';
import { readImage, extensionToImageIo } from '@itk-wasm/image-io';
import type { vtkObject } from '@kitware/vtk.js/interfaces';
import { getWorker } from '@/src/io/itk/worker';
import { FileReaderMap, ReaderResult } from '.';

import { stlReader, vtiReader, vtpReader } from './vtk/async';
import { FILE_EXT_TO_MIME } from './mimeTypes';
import { imageHeaderMetadata } from './imageHeaderMetadata';

export const ITK_IMAGE_MIME_TYPES = Array.from(
  new Set(
    Array.from(extensionToImageIo.keys()).map(
      (ext) => FILE_EXT_TO_MIME[ext.toLowerCase()]
    )
  )
);

async function itkReader(file: File): Promise<ReaderResult> {
  const { image } = await readImage(file, {
    webWorker: getWorker(),
  });
  const vtkImage = convertItkToVtkImage(image);
  const headerMetadata = await imageHeaderMetadata(file, image);
  return { dataObject: vtkImage, headerMetadata };
}

const withoutMetadata =
  (read: (file: File) => Promise<vtkObject>) =>
  async (file: File): Promise<ReaderResult> => ({
    dataObject: await read(file),
  });

/**
 * Resets the file reader map to the default values.
 */
export function registerAllReaders(readerMap: FileReaderMap) {
  readerMap.set('application/vnd.unknown.vti', withoutMetadata(vtiReader));
  readerMap.set('application/vnd.unknown.vtp', withoutMetadata(vtpReader));
  readerMap.set('model/stl', withoutMetadata(stlReader));

  ITK_IMAGE_MIME_TYPES.forEach((mime) => {
    readerMap.set(mime, itkReader);
  });
}
