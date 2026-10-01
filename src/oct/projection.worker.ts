import * as Comlink from 'comlink';
import { projectEnFace as project } from '@/src/oct/projection';
import type { ProjectionInput } from '@/src/oct/types';

function projectEnFace(input: ProjectionInput) {
  const result = project(input);
  const buffers: ArrayBuffer[] = [result.values.buffer as ArrayBuffer];
  if (result.thicknessMicrons) {
    buffers.push(result.thicknessMicrons.buffer as ArrayBuffer);
  }
  if (result.thinMask) {
    buffers.push(result.thinMask.buffer as ArrayBuffer);
  }
  return Comlink.transfer(result, buffers);
}

export type ProjectionWorker = { projectEnFace: typeof projectEnFace };

Comlink.expose({ projectEnFace });
