import StreamingByteReader from '@/src/core/streaming/streamingByteReader';
import { Maybe } from '../types';

interface MagicDatabase {
  mime: string;
  header: number[];
  skip?: number;
  readTotal: number;
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
].map((magic) => ({
  ...magic,
  readTotal: (magic.skip ?? 0) + magic.header.length,
}));

// How much data to read when extracting file magic.
const HEAD_CHUNK = Math.max(...FILE_MAGIC_DB.map((magic) => magic.readTotal));

function prefixEquals(
  target: number[] | Uint8Array,
  prefix: number[] | Uint8Array
) {
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

const STREAMING_MAGIC_ORDER = FILE_MAGIC_DB.sort(
  (a, b) => a.readTotal - b.readTotal
);

/**
 * Gets the mime type from a streaming byte reader.
 *
 * Also returns the file stream prefix.
 * @param stream
 * @returns
 */
export function* getFileMimeFromMagicStream(reader: StreamingByteReader) {
  const head: number[] = [];
  for (let i = 0; i < STREAMING_MAGIC_ORDER.length; i++) {
    const { mime, header, readTotal, skip = 0 } = STREAMING_MAGIC_ORDER[i];
    if (head.length < readTotal) {
      const bytes = yield* reader.read(readTotal - head.length);
      head.push(...bytes);
    }
    if (prefixEquals(head.slice(skip), header)) {
      return mime;
    }
  }
  return null;
}
