import { Maybe } from '../types';

interface MagicDatabase {
  mime: string;
  header: number[];
  skip?: number;
}

/**
 * file magic database
 * Used to handle certain cases where files have no extension
 */
const FILE_MAGIC_DB: MagicDatabase[] = [
  {
    mime: 'application/dicom',
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

export async function getFileMimeFromMagic(file: File): Promise<Maybe<string>> {
  return new Promise((resolve) => {
    const head = file.slice(0, HEAD_CHUNK);
    const reader = new FileReader();
    reader.onload = () => {
      const chunk = new Uint8Array(reader.result! as ArrayBuffer);
      for (let i = 0; i < FILE_MAGIC_DB.length; i += 1) {
        const { mime, header, skip = 0 } = FILE_MAGIC_DB[i];
        if (prefixEquals(chunk.slice(skip), header)) {
          resolve(mime);
          return;
        }
      }
      resolve(null);
    };
    reader.readAsArrayBuffer(head);
  });
}
