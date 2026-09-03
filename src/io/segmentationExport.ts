import JSZip from 'jszip';

/** One written file on its way to the browser. */
export type ExportFile = {
  name: string;
  data: string | Uint8Array<ArrayBuffer>;
};

/**
 * The name a group's file carries. The first keeps the plain stem, so a
 * segmentation with no overlap saves as the one file it always did.
 */
export const layerFileName = (stem: string, format: string, layer: number) =>
  layer === 0 ? `${stem}.${format}` : `${stem}_layer${layer}.${format}`;

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
    name: `${stem}.zip`,
    blob: await zip.generateAsync({ type: 'blob' }),
  };
}
