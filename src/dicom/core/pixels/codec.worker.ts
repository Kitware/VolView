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

/** A codec whose WASM loads on the first job that names it. */
const lazily = (load: () => Promise<FrameCodec>) => {
  let codec: Promise<FrameCodec> | undefined;
  return () => (codec ??= load());
};

const libJpegTurbo = lazily(async () => {
  const module = await createLibJpegTurbo({
    locateFile: () => libJpegTurboWasmUrl,
  });
  return embindFrameCodec(module.JPEGDecoder);
});

const CODECS: Record<
  CodecName,
  Readonly<{ name: string; open: (job: CodecJob) => Promise<FrameCodec> }>
> = {
  htj2k: {
    name: 'HTJ2K',
    open: lazily(async () => {
      const module = await createOpenJph({ locateFile: () => openJphWasmUrl });
      return embindFrameCodec(module.HTJ2KDecoder);
    }),
  },
  jpeg: {
    name: 'JPEG',
    open: async ({ photometricInterpretation }) => {
      const decode = await libJpegTurbo();
      return photometricInterpretation === 'RGB'
        ? (frame) => decode(asStoredRgb(frame))
        : decode;
    },
  },
  jpeg2000: {
    name: 'JPEG 2000',
    open: lazily(async () => {
      const module = await createOpenJpeg({
        locateFile: () => openJpegWasmUrl,
      });
      return embindFrameCodec(module.J2KDecoder);
    }),
  },
  jpegLossless: {
    name: 'JPEG Lossless',
    open: async ({ shape }) => jpegLosslessFrameCodec(shape),
  },
  jpegLs: {
    name: 'JPEG-LS',
    open: lazily(async () => {
      const module = await createCharLs({ locateFile: () => charLsWasmUrl });
      return embindFrameCodec(module.JpegLSDecoder);
    }),
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
