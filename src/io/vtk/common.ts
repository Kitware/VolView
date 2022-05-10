import { vtkReader, vtkClass } from '@/src/types/vtk-types';
import { readFileAsArrayBuffer, readFileAsUTF8Text } from '@/src/io';

export default async function readFile(
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
