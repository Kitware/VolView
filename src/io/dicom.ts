import {
  readOverlappingSegmentation,
  ReadOverlappingSegmentationResult,
} from '@itk-wasm/dicom';

import { getWorker } from '@/src/io/itk/worker';

type DicomSegmentAttributes = {
  SegmentLabel: string;
  labelID: number;
  recommendedDisplayRGBValue: [number, number, number];
};

export type ReadOverlappingSegmentationMeta = {
  segmentAttributes: DicomSegmentAttributes[][];
};

type ReadOverlappingSegmentationResultWithRealMeta =
  ReadOverlappingSegmentationResult & {
    metaInfo: ReadOverlappingSegmentationMeta;
  };

export async function readDicomSegmentation(file: File) {
  return (await readOverlappingSegmentation(file, {
    webWorker: getWorker(),
    mergeSegments: true,
  })) as ReadOverlappingSegmentationResultWithRealMeta;
}
