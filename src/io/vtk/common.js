import { readFileAsArrayBuffer } from '../io';

export default async function readFile(file, vtkReaderClass, asBinary = true) {
  const buffer = await readFileAsArrayBuffer(file);
  const reader = vtkReaderClass.newInstance();
  if (asBinary) {
    reader.parseAsArrayBuffer(buffer);
  } else {
    // assume single-byte chars
    const str = String.fromCharCode.apply(null, new Uint8Array(buffer));
    reader.parseAsText(str);
  }

  return reader.getOutputData();
}
