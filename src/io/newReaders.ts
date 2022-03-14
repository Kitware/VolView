import { vtkObject } from '@kitware/vtk.js/interfaces';
import vtkITKImageReader from '@kitware/vtk.js/IO/Misc/ITKImageReader';
import readImageArrayBuffer from 'itk/readImageArrayBuffer';

import { readFileAsArrayBuffer, ITK_IMAGE_EXTENSIONS } from './newIO';
import { stlReader, vtiReader, vtpReader } from './vtk/async';

vtkITKImageReader.setReadImageArrayBufferFromITK(readImageArrayBuffer);

export async function itkReader(file: File) {
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

type ReaderType = (file: File) => vtkObject | Promise<vtkObject>;

function getFileReaders(): Record<string, ReaderType> {
  const readers: Record<string, ReaderType> = {
    vti: vtiReader,
    vtp: vtpReader,
    stl: stlReader,
  };

  ITK_IMAGE_EXTENSIONS.forEach((ext) => {
    readers[ext] = itkReader;
  });
  return readers;
}

export const FILE_READERS = getFileReaders();
