import JSZip from 'jszip';

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
