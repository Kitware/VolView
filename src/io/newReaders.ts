import { vtkObject } from '@kitware/vtk.js/interfaces';
import vtkITKImageReader from '@kitware/vtk.js/IO/Misc/ITKImageReader';
import readImageArrayBuffer from 'itk/readImageArrayBuffer';

import { readFileAsArrayBuffer, ITK_IMAGE_EXTENSIONS } from './newIO';
import { stlReader, vtiReader, vtpReader } from './vtk/async';

vtkITKImageReader.setReadImageArrayBufferFromITK(readImageArrayBuffer);

export type ReaderType = (file: File) => vtkObject | Promise<vtkObject>;
export type FileReaderMap = Map<string, ReaderType>;

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

// export function createTREReader(dicomIO) {
//   return async function TREReader(file) {
//     const treData = await dicomIO.readTRE(file);
//     return convertJsonToTre(treData);
//   };
// }

/**
 * A map of the currently registered file readers.
 */
export const fileReaders: FileReaderMap = new Map();

/**
 * Resets the file reader map to the default values.
 */
export function resetToDefaultReaders() {
  fileReaders.clear();
  fileReaders.set('vti', vtiReader);
  fileReaders.set('vtp', vtpReader);
  fileReaders.set('stl', stlReader);

  ITK_IMAGE_EXTENSIONS.forEach((ext) => {
    fileReaders.set(ext, itkReader);
  });
}

// initialize the file readers
resetToDefaultReaders();
