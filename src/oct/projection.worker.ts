import { projectEnFace as project } from '@/src/oct/projection';
import type { ProjectionInput } from '@/src/oct/types';

self.onmessage = ({ data }: MessageEvent<ProjectionInput>) => {
  const result = project(data);
  const buffers: ArrayBuffer[] = [result.values.buffer as ArrayBuffer];
  if (result.thicknessMicrons) {
    buffers.push(result.thicknessMicrons.buffer as ArrayBuffer);
  }
  self.postMessage(result, buffers);
};
