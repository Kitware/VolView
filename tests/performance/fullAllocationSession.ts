import fs from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import JSZip from 'jszip';

/** Restore explicit full-volume allocations without changing the sample's voxels. */
export async function writeFullAllocationSession(
  inputZip: string,
  outputZip: string
) {
  const original = await JSZip.loadAsync(await fs.readFile(inputZip));
  const anatomy = await original.file('jhu-hc01.nrrd')!.async('nodebuffer');
  const labelmap = await original
    .file('jhu-hc01.seg.nrrd')!
    .async('nodebuffer');
  const separator = labelmap.indexOf('\n\n');
  const header = labelmap.subarray(0, separator).toString();
  const labels = gunzipSync(labelmap.subarray(separator + 2));
  const dimensions = [512, 496, 49];
  if (labels.length !== dimensions.reduce((a, b) => a * b, 1)) {
    throw new Error(
      'The retinal fixture must contain 512 × 496 × 49 uint8 voxels'
    );
  }
  const fields = Object.fromEntries(
    header
      .split('\n')
      .filter((line) => line.includes(':='))
      .map((line) => {
        const split = line.indexOf(':=');
        return [line.slice(0, split), line.slice(split + 2)];
      })
  );
  const maskHeader = Buffer.from(
    `${header
      .split('\n')
      .filter((line) => !line.startsWith('Segment'))
      .join('\n')}\n\n`
  );
  const extent = [0, 511, 0, 495, 0, 48];
  const zip = new JSZip();
  zip.file('data/jhu-hc01.nrrd', anatomy);
  const segments = [];
  const masks = [];
  for (let index = 0; index < 8; index++) {
    const value = index + 1;
    const name = fields[`Segment${index}_Name`];
    const color = fields[`Segment${index}_Color`]
      .split(' ')
      .map((component) => Math.round(Number(component) * 255));
    const pixels = new Uint8Array(labels.length);
    for (let offset = 0; offset < labels.length; offset++) {
      pixels[offset] = Number(labels[offset] === value);
    }
    const path = `masks/mask-${value}.nrrd`;
    zip.file(path, Buffer.concat([maskHeader, gzipSync(pixels, { level: 1 })]));
    const segmentId = `segment-${value}`;
    segments.push({
      id: segmentId,
      name,
      color: [...color, 255],
      visible: true,
      locked: false,
    });
    masks.push({
      id: `mask-${value}`,
      segmentId,
      representations: { labelmap: { path, name, extent } },
    });
  }
  zip.file(
    'manifest.json',
    JSON.stringify({
      version: '7.0.0',
      datasets: [{ id: 'jhu-image', dataSourceId: 1 }],
      dataSources: [
        {
          id: 1,
          type: 'file',
          fileId: 1,
          fileType: 'application/octet-stream',
        },
      ],
      datasetFilePath: { '1': 'data/jhu-hc01.nrrd' },
      primarySelection: 'jhu-image',
      selectedSegment: 'segment-1',
      segments,
      segmentations: [
        {
          id: 'jhu-segmentation',
          name: 'jhu-hc01',
          parentImage: 'jhu-image',
          masks,
          order: masks.map(({ id }) => id),
          fillOpacity: 0.3,
          outlineOpacity: 1,
          outlineThickness: 2,
        },
      ],
    })
  );
  await fs.writeFile(
    outputZip,
    await zip.generateAsync({ type: 'nodebuffer' })
  );
}
