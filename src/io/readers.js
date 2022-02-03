import vtkITKImageReader from '@kitware/vtk.js/IO/Misc/ITKImageReader';
import extensionToImageIO from 'itk/extensionToImageIO';
import readImageArrayBuffer from 'itk/readImageArrayBuffer';

import convertJsonToTre from '@/src/vtk/TreJsonConverter';
import { readFileAsArrayBuffer } from './io';
import { VtkVtiReader, VtkVtpReader } from './vtk/sync';
import { VtkStlReader } from './vtk/async';

vtkITKImageReader.setReadImageArrayBufferFromITK(readImageArrayBuffer);

const itkImageExtensions = Array.from(
  new Set(Array.from(extensionToImageIO.keys()).map((ext) => ext.toLowerCase()))
);

export async function itkReader(file) {
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

export function createTREReader(dicomIO) {
  return async function TREReader(file) {
    const treData = await dicomIO.readTRE(file);
    return convertJsonToTre(treData);
  };
}

export function registerAllReaders(io) {
  itkImageExtensions.forEach((ext) => io.addSingleReader(ext, itkReader));
  io.addSingleReader('vti', VtkVtiReader);
  io.addSingleReader('vtp', VtkVtpReader);
  io.addSingleReader('stl', VtkStlReader);
}
