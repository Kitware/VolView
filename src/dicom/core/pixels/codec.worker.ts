import * as Comlink from 'comlink';
import createCharLs from '@cornerstonejs/codec-charls/decodewasmjs';
import charLsWasmUrl from '@cornerstonejs/codec-charls/decodewasm?url';
import createLibJpegTurbo from '@cornerstonejs/codec-libjpeg-turbo-8bit/decodewasmjs';
import libJpegTurboWasmUrl from '@cornerstonejs/codec-libjpeg-turbo-8bit/decodewasm?url';
import createOpenJpeg from '@cornerstonejs/codec-openjpeg/decodewasmjs';
import openJpegWasmUrl from '@cornerstonejs/codec-openjpeg/decodewasm?url';
import createOpenJph from '@cornerstonejs/codec-openjph';
import openJphWasmUrl from '@cornerstonejs/codec-openjph/wasm?url';
import {
  decodeEncapsulatedFrames,
  type CodecJob,
  type CodecName,
  type FrameCodec,
} from './codecFrames';
import { embindFrameCodec } from './embindFrames';
import { asStoredRgb } from './jpegColour';
import { jpegLosslessFrameCodec } from './jpegLosslessFrame';
import { rleFrameCodec } from './rleFrame';

/** Loads on first use and keeps the result; a failed load is tried again. */
const lazily = <T>(load: () => Promise<T>) => {
  let loaded: Promise<T> | undefined;
  return () =>
    (loaded ??= load().catch((error) => {
      loaded = undefined;
      throw error;
    }));
};

const openJph = lazily(() =>
  createOpenJph({ locateFile: () => openJphWasmUrl })
);
const openJpeg = lazily(() =>
  createOpenJpeg({ locateFile: () => openJpegWasmUrl })
);
const charLs = lazily(() => createCharLs({ locateFile: () => charLsWasmUrl }));
const libJpegTurbo = lazily(() =>
  createLibJpegTurbo({ locateFile: () => libJpegTurboWasmUrl })
);

const CODECS: Record<
  CodecName,
  Readonly<{ name: string; open: (job: CodecJob) => Promise<FrameCodec> }>
> = {
  htj2k: {
    name: 'HTJ2K',
    open: async ({ shape }) =>
      embindFrameCodec((await openJph()).HTJ2KDecoder, shape),
  },
  jpeg: {
    name: 'JPEG',
    open: async ({ shape, photometricInterpretation }) => {
      const decode = embindFrameCodec(
        (await libJpegTurbo()).JPEGDecoder,
        shape
      );
      return photometricInterpretation === 'RGB'
        ? (frame) => decode(asStoredRgb(frame))
        : decode;
    },
  },
  jpeg2000: {
    name: 'JPEG 2000',
    open: async ({ shape }) =>
      embindFrameCodec((await openJpeg()).J2KDecoder, shape),
  },
  jpegLossless: {
    name: 'JPEG Lossless',
    open: async ({ shape }) => jpegLosslessFrameCodec(shape),
  },
  jpegLs: {
    name: 'JPEG-LS',
    open: async ({ shape }) =>
      embindFrameCodec((await charLs()).JpegLSDecoder, shape),
  },
  rle: { name: 'RLE', open: async ({ shape }) => rleFrameCodec(shape) },
};

const api = {
  async decode(job: CodecJob) {
    const { name, open } = CODECS[job.codec];
    const frames = decodeEncapsulatedFrames(name, await open(job), job);
    return Comlink.transfer(frames, [frames.bytes.buffer]);
  },
};

export type CodecWorker = typeof api;

Comlink.expose(api);
