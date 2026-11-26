import * as Comlink from 'comlink';
import createOpenJph, {
  type OpenJphModule,
} from '@cornerstonejs/codec-openjph';
import openJphWasmUrl from '@cornerstonejs/codec-openjph/wasm?url';
import {
  decodeEncapsulatedFrames,
  type CodecJob,
  type CodecName,
  type FrameCodec,
  type FrameShape,
} from './codecFrames';
import { openJphFrameCodec } from './htj2kFrames';
import { rleFrameCodec } from './rleFrame';

let openJph: Promise<OpenJphModule> | undefined;
const loadOpenJph = () =>
  (openJph ??= createOpenJph({ locateFile: () => openJphWasmUrl }));

// Each codec's WASM loads on the first job that names it.
const CODECS: Record<
  CodecName,
  Readonly<{ name: string; open: (shape: FrameShape) => Promise<FrameCodec> }>
> = {
  htj2k: {
    name: 'HTJ2K',
    open: async () => openJphFrameCodec(await loadOpenJph()),
  },
  rle: { name: 'RLE', open: async (shape) => rleFrameCodec(shape) },
};

const api = {
  async decode(job: CodecJob) {
    const { name, open } = CODECS[job.codec];
    const frames = decodeEncapsulatedFrames(name, await open(job.shape), job);
    return Comlink.transfer(frames, [frames.bytes.buffer]);
  },
};

export type CodecWorker = typeof api;

Comlink.expose(api);
