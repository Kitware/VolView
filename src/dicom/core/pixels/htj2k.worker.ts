import * as Comlink from 'comlink';
import createOpenJph, {
  type OpenJphModule,
} from '@cornerstonejs/codec-openjph';
import openJphWasmUrl from '@cornerstonejs/codec-openjph/wasm?url';
import { decodeHtj2kFrames } from './htj2kFrames';

let openJph: Promise<OpenJphModule> | undefined;
const loadOpenJph = () =>
  (openJph ??= createOpenJph({ locateFile: () => openJphWasmUrl }));

const api = {
  async decode(value: Uint8Array, frameCount: number) {
    const frames = decodeHtj2kFrames(await loadOpenJph(), value, frameCount);
    return Comlink.transfer(frames, [frames.bytes.buffer]);
  },
};

export type Htj2kWorker = typeof api;

Comlink.expose(api);
