import vtkXMLImageDataReader from '@kitware/vtk.js/IO/XML/XMLImageDataReader';
import vtkXMLPolyDataReader from '@kitware/vtk.js/IO/XML/XMLPolyDataReader';
import readFile from './common';

export async function VtkVtiReader(file) {
  return readFile(file, vtkXMLImageDataReader);
}

export async function VtkVtpReader(file) {
  return readFile(file, vtkXMLPolyDataReader);
}
