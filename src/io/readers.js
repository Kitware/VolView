import vtkITKImageReader from 'vtk.js/Sources/IO/Misc/ITKImageReader';
import extensionToImageIO from 'itk/extensionToImageIO';
import readImageArrayBuffer from 'itk/readImageArrayBuffer';

import { readFileAsArrayBuffer } from './io';
import { VtkVtiReader, VtkVtpReader } from './vtk/sync';
import { VtkStlReader } from './vtk/async';

vtkITKImageReader.setReadImageArrayBufferFromITK(readImageArrayBuffer);

const itkImageExtensions = Array.from(
  new Set(Array.from(extensionToImageIO.keys()).map((ext) => ext.toLowerCase())),
);

export async function itkReader(file) {
  const fileBuffer = await readFileAsArrayBuffer(file);

  const reader = vtkITKImageReader.newInstance();
  reader.setFileName(file.name);
  await reader.parseAsArrayBuffer(fileBuffer);

  return reader.getOutputData();
}

export function registerAllReaders(io) {
  itkImageExtensions.forEach((ext) => io.registerReader(ext, itkReader));
  io.registerReader('vti', VtkVtiReader);
  io.registerReader('vtp', VtkVtpReader);
  io.registerReader('stl', VtkStlReader);
}
