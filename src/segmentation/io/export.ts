import JSZip from 'jszip';
import {
  captureLabelmapParts,
  composeLabelmapPart,
} from '@/src/segmentation/io/composition';
import { writeSegmentation } from '@/src/io/readWriteImage';
import { sanitizeSegmentationFileStem } from '@/src/io/state-file/maskArchivePath';
import type { SegmentMask } from '@/src/segmentation/model';
import { isRegularImage } from '@/src/utils/dataSelection';
import { stripExtension } from '@/src/utils/path';

export type ExportFile = {
  name: string;
  data: string | Uint8Array<ArrayBuffer>;
};

/**
 * The name of one export part's file. Parts past the first come from overlap
 * or from the 65535-label capacity; the first keeps the plain stem.
 */
export const layerFileName = (stem: string, format: string, layer: number) =>
  layer === 0 ? `${stem}.${format}` : `${stem}_layer${layer}.${format}`;

export const archiveNameFor = (stem: string) => `${stem}.zip`;

/**
 * The stem a segmentation is saved and staged under. Its name starts as its
 * image's, so a file-backed one drops the file's extension, and a DICOM series
 * name stays whole: its dots are not an extension.
 */
export const segmentationFileStem = (parentImageId: string, name: string) =>
  sanitizeSegmentationFileStem(
    isRegularImage(parentImageId) ? stripExtension(name) : name
  );

export async function writeLabelmapParts(
  { parentId, parts }: { parentId: string; parts: SegmentMask[][] },
  stem: string,
  format: string,
  {
    deliver,
    write = writeSegmentation,
  }: {
    deliver: (file: ExportFile) => Promise<void> | void;
    write?: typeof writeSegmentation;
  }
) {
  // Captured before the first await, so an edit made meanwhile misses the files.
  const snapshot = captureLabelmapParts(parentId, parts);
  // One at a time: serializing copies the whole buffer, and itk-wasm queues
  // the writes on one shared worker whatever the caller does.
  for (const [index, part] of snapshot.parts.entries()) {
    const { labelmap, segments } = composeLabelmapPart(snapshot.parent, part);
    const data = await write(format, labelmap, segments);
    await deliver({ name: layerFileName(stem, format, index), data });
  }
}

/**
 * What a save hands to the browser: the single file itself, or every file in
 * one archive. A labelmap file carries one label per voxel, so segments that
 * overlap cannot share one and the save turns into several.
 */
export async function bundleExportFiles(stem: string, files: ExportFile[]) {
  const [first] = files;
  if (files.length === 1) {
    return { name: first.name, blob: new Blob([first.data]) };
  }

  const zip = new JSZip();
  files.forEach((file) => zip.file(file.name, file.data));
  return {
    name: archiveNameFor(stem),
    blob: await zip.generateAsync({ type: 'blob' }),
  };
}
