import { FILE_EXTENSIONS, FILE_EXT_TO_MIME, MIME_TYPES } from './mimeTypes';
import { Maybe } from '../types';
import { getFileMimeFromMagic } from './magic';

/**
 * Determines the file's mime type.
 *
 * Returns the file's mime type for supported mime types.
 */
export async function getFileMimeType(file: File): Promise<Maybe<string>> {
  const fileType = file.type.toLowerCase();
  if (MIME_TYPES.has(fileType)) {
    return fileType;
  }

  if (FILE_EXTENSIONS.has(fileType)) {
    return FILE_EXT_TO_MIME[fileType];
  }

  const supportedExt = [...FILE_EXTENSIONS].find((ext) =>
    file.name.toLowerCase().endsWith(`.${ext}`)
  );
  if (supportedExt) {
    return FILE_EXT_TO_MIME[supportedExt];
  }

  const mimeFromMagic = await getFileMimeFromMagic(file);
  if (mimeFromMagic && MIME_TYPES.has(mimeFromMagic)) {
    return mimeFromMagic;
  }

  return null;
}

/**
 * Retypes a given File.
 *
 * Handy for when a file object has no type given.
 * Type is inferred from extension or magic.
 *
 * If type is not supported, file.type will be "".
 * @param file
 */
export async function retypeFile(file: File): Promise<File> {
  const type = (await getFileMimeType(file)) ?? '';
  return new File([file], file.name, { type: type.toLowerCase() });
}

export type ReadAsType = 'ArrayBuffer' | 'Text';

async function readFileAs<T extends ArrayBuffer | string>(
  file: File,
  type: ReadAsType
): Promise<T> {
  return new Promise((resolve) => {
    const fio = new globalThis.FileReader();
    fio.onload = () => resolve(fio.result as T);
    if (type === 'ArrayBuffer') {
      fio.readAsArrayBuffer(file);
    } else if (type === 'Text') {
      fio.readAsText(file);
    } else {
      throw new TypeError(`readAs${type} is not a function`);
    }
  });
}

/**
 * Reads a file and returns an ArrayBuffer
 * @async
 * @param {File} file
 */
export async function readFileAsArrayBuffer(file: File) {
  return readFileAs<ArrayBuffer>(file, 'ArrayBuffer');
}

/**
 * Reads a file and returns UTF-8 text
 * @async
 * @param {File} file
 */
export async function readFileAsUTF8Text(file: File) {
  return readFileAs<string>(file, 'Text');
}
