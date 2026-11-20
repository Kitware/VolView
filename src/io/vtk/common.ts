import { vtkReader, vtkWriter, vtkClass } from '@/src/types/vtk-types';
import { readFileAsArrayBuffer, readFileAsUTF8Text } from '@/src/io';
import vtkDataSet from '@kitware/vtk.js/Common/DataModel/DataSet';

export async function readFile(
  file: File,
  vtkReaderClass: vtkClass,
  asBinary = true
) {
  const reader: vtkReader = vtkReaderClass.newInstance() as vtkReader;
  if (asBinary) {
    const buffer = await readFileAsArrayBuffer(file);
    reader.parseAsArrayBuffer(buffer);
  } else {
    const buffer = await readFileAsUTF8Text(file);
    reader.parseAsText(buffer);
  }
  return reader.getOutputData();
}

export async function writeData(vtkWriterClass: vtkClass, data: vtkDataSet) {
  const writer: vtkWriter = vtkWriterClass.newInstance() as vtkWriter;

  return writer.write(data);
}

export interface StateObject {
  vtkClass: string;
  [attrName: string]: unknown;
}
