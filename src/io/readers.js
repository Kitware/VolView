import vtkXMLImageDataReader from 'vtk.js/Sources/IO/XML/XMLImageDataReader';
import vtkXMLPolyDataReader from 'vtk.js/Sources/IO/XML/XMLPolyDataReader';
import vtkSTLReader from 'vtk.js/Sources/IO/Geometry/STLReader';
import vtkITKImageReader from 'vtk.js/Sources/IO/Misc/ITKImageReader';
import extensionToImageIO from 'itk/extensionToImageIO';
import readImageArrayBuffer from 'itk/readImageArrayBuffer';

import { readFileAsArrayBuffer } from './io';

vtkITKImageReader.setReadImageArrayBufferFromITK(readImageArrayBuffer);

const itkImageExtensions = Array.from(
  new Set(Array.from(extensionToImageIO.keys()).map((ext) => ext.toLowerCase())),
);

export async function itkReader(file) {
  const fileBuffer = await readFileAsArrayBuffer(file);

  const reader = vtkITKImageReader.newInstance();
  reader.setFileName(file.name);
  await reader.parseAsArrayBuffer(fileBuffer);

  const dataset = reader.getOutputData();
  // don't reference reader in this closure as to avoid memory leaks
  return () => dataset;
}

export async function vtkReaderFactory(vtkReaderClass, binary = true) {
  return async function vtkReader(file) {
    const fileBuffer = await readFileAsArrayBuffer(file);
    const reader = vtkReaderClass.newInstance();
    if (binary) {
      reader.parseAsArrayBuffer(fileBuffer);
    } else {
      reader.parseAsText(fileBuffer);
    }
    const dataset = reader.getOutputData();
    // don't reference reader in this closure as to avoid memory leaks
    return () => dataset;
  };
}

export function registerAllReaders(io) {
  itkImageExtensions.forEach((ext) => io.registerReader(ext, itkReader));
  io.registerReader('vti', vtkReaderFactory(vtkXMLImageDataReader));
  io.registerReader('vtp', vtkReaderFactory(vtkXMLPolyDataReader));
  io.registerReader('stl', vtkReaderFactory(vtkSTLReader));
}
