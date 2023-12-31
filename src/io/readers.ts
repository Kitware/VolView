import vtkITKImageReader from '@kitware/vtk.js/IO/Misc/ITKImageReader';
import { convertItkToVtkImage } from '@kitware/vtk.js/Common/DataModel/ITKHelper';
import { readImageArrayBuffer, extensionToImageIO } from 'itk-wasm';
import { readImage } from '@itk-wasm/image-io';
import { FileReaderMap } from '.';

import { stlReader, vtiReader, vtpReader } from './vtk/async';
import { FILE_EXT_TO_MIME } from './mimeTypes';

export const ITK_IMAGE_MIME_TYPES = Array.from(
  new Set(
    Array.from(extensionToImageIO.keys()).map(
      (ext) => FILE_EXT_TO_MIME[ext.toLowerCase()]
    )
  )
);

vtkITKImageReader.setReadImageArrayBufferFromITK(readImageArrayBuffer);

async function itkReader(file: File) {
  const { image, webWorker } = await readImage(null, file);
  webWorker.terminate();
  return convertItkToVtkImage(image);
}

/**
 * Resets the file reader map to the default values.
 */
export function registerAllReaders(readerMap: FileReaderMap) {
  readerMap.set('application/vnd.unknown.vti', vtiReader);
  readerMap.set('application/vnd.unknown.vtp', vtpReader);
  readerMap.set('model/stl', stlReader);

  ITK_IMAGE_MIME_TYPES.forEach((mime) => {
    readerMap.set(mime, itkReader);
  });
}
