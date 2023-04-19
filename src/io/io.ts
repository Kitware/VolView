import { extensionToImageIO } from 'itk-wasm';
import { extractFilesFromZip } from './zip';
import { DatasetFile } from '../store/datasets-files';
import { partition } from '../utils';

export const ARCHIVE_FILE_TYPES = new Set(['zip', 'application/zip']);

export const ITK_IMAGE_EXTENSIONS = Array.from(
  new Set(Array.from(extensionToImageIO.keys()).map((ext) => ext.toLowerCase()))
);

// remove duplicates
export const FILE_TYPES = Array.from(
  new Set(['vti', 'vtp', 'stl', 'dcm', 'zip', 'json', ...ITK_IMAGE_EXTENSIONS])
);

/**
 * file magic database
 * Used to handle certain cases where files have no extension
 */
const FILE_MAGIC_DB = [
  {
    type: 'dcm',
    skip: 128,
    header: Array.from('DICM').map((c) => c.charCodeAt(0)),
  },
];

// How much data to read when extracting file magic.
// This should be generous enough for most files.
const HEAD_CHUNK = 512;

function prefixEquals(target: Uint8Array, prefix: number[] | Uint8Array) {
  if (prefix.length > target.length) {
    return false;
  }
  for (let i = 0; i < prefix.length; i += 1) {
    if (prefix[i] !== target[i]) {
      return false;
    }
  }
  return true;
}

async function getFileTypeFromMagic(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const head = file.slice(0, HEAD_CHUNK);
    const reader = new FileReader();
    reader.onload = () => {
      const chunk = new Uint8Array(reader.result! as ArrayBuffer);
      for (let i = 0; i < FILE_MAGIC_DB.length; i += 1) {
        const { type, header, skip = 0 } = FILE_MAGIC_DB[i];
        if (prefixEquals(chunk.slice(skip), header)) {
          resolve(type);
          return;
        }
      }
      resolve(null);
    };
    reader.readAsArrayBuffer(head);
  });
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
  if (file.type) return file;

  let type: string | null;

  type =
    FILE_TYPES.find((ext) => file.name.toLowerCase().endsWith(`.${ext}`)) ??
    null;

  if (!type) {
    type = await getFileTypeFromMagic(file);
  }

  if (!type) {
    type = '';
  }

  const retypedFile = new File([file], file.name, { type: type.toLowerCase() });
  return retypedFile;
}

const isZip = (datasetFile: DatasetFile) =>
  ARCHIVE_FILE_TYPES.has(datasetFile.file.type);

export async function extractArchivesRecursively(
  files: DatasetFile[]
): Promise<DatasetFile[]> {
  if (!files.length) return [];

  const [archives, loadableFiles] = partition(isZip, files);

  const unzipped = await Promise.all(
    archives.flatMap(async (zip) => {
      const entries = await extractFilesFromZip(zip.file);
      return entries.map((datasetFileWithPath) => ({
        ...zip, // preserve zip's remote provenance
        ...datasetFileWithPath,
      }));
    })
  );

  const retyped = await Promise.all(
    unzipped.flat().map(async ({ file, ...rest }) => {
      return { file: await retypeFile(file), ...rest };
    })
  );

  const moreEntries = await extractArchivesRecursively(retyped);
  return [...loadableFiles, ...moreEntries];
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
