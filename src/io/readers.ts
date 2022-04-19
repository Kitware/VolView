import vtkITKImageReader from '@kitware/vtk.js/IO/Misc/ITKImageReader';
import readImageArrayBuffer from 'itk/readImageArrayBuffer';
import { FileReaderMap } from '.';

import { readFileAsArrayBuffer, ITK_IMAGE_EXTENSIONS } from './io';
import { stlReader, vtiReader, vtpReader } from './vtk/async';

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
  readerMap.set('vti', vtiReader);
  readerMap.set('vtp', vtpReader);
  readerMap.set('stl', stlReader);

  ITK_IMAGE_EXTENSIONS.forEach((ext) => {
    readerMap.set(ext, itkReader);
  });
}
