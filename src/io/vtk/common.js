import { readFileAsArrayBuffer, readFileAsUTF8Text } from '../io';

export default async function readFile(file, vtkReaderClass, asBinary = true) {
  const reader = vtkReaderClass.newInstance();
  if (asBinary) {
    const buffer = await readFileAsArrayBuffer(file);
    reader.parseAsArrayBuffer(buffer);
  } else {
    const buffer = await readFileAsUTF8Text(file);
    reader.parseAsText(buffer);
  }
  return reader.getOutputData();
}
