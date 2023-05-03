import vtkITKImageReader from '@kitware/vtk.js/IO/Misc/ITKImageReader';
import { readImageArrayBuffer, extensionToImageIO } from 'itk-wasm';
import { FileReaderMap } from '.';

import { readFileAsArrayBuffer } from './io';
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
  const fileBuffer = await readFileAsArrayBuffer(file);

  const reader = vtkITKImageReader.newInstance();
  reader.setFileName(file.name);
  try {
    await reader.parseAsArrayBuffer(fileBuffer);
  } catch (e) {
    // itkreader doesn't give us a meaningful error
    throw new Error('Failed to parse file');
  }

  return reader.getOutputData();
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
