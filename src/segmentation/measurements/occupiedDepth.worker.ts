import { createOccupiedDepthHandler } from '@/src/segmentation/measurements/occupiedDepthHandler';
import type { MeasurementRequest } from '@/src/segmentation/measurements/occupiedDepthHandler';

const handle = createOccupiedDepthHandler();
self.onmessage = ({ data }: MessageEvent<MeasurementRequest>) => {
  const response = handle(data);
  const transfer = response.result ? [response.result.counts.buffer] : [];
  self.postMessage(response, transfer);
};
