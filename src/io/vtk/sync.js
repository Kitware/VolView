import vtkXMLImageDataReader from 'vtk.js/Sources/IO/XML/XMLImageDataReader';
import vtkXMLPolyDataReader from 'vtk.js/Sources/IO/XML/XMLPolyDataReader';
import readFile from './common';

export async function VtkVtiReader(file) {
  return readFile(file, vtkXMLImageDataReader);
}

export async function VtkVtpReader(file) {
  return readFile(file, vtkXMLPolyDataReader);
}
