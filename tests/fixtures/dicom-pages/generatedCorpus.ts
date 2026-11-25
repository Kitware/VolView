import reference from '../oct/reference.json';
import { createSyntheticOCT, element, syntheticScalars } from '../oct/dicom';
import { part10File } from '../../specs/syntheticDicom';
import { htj2kSignedFrames } from './htj2kCorpus';

const [width, depth, frames] = reference.size;
const [sx] = reference.spacing;
const bScans = (count: number) =>
  syntheticScalars().subarray(0, width * depth * count);

// Unpositioned B-scans, as many enhanced OCT exports write them.
const unpositioned = Array.from(
  { length: frames },
  (_, frame) => `52009230[${frame}].00209113`
);
const sharedMeasure = (tag: string) => `52009229.00289110.${tag}`;

/** B-scans rotated about the depth axis through the scan centre. */
function radialPlanes(count: number) {
  const centre = (width * sx) / 2;
  return (frame: number) => {
    const angle = (frame * Math.PI) / count;
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    const fixed = (value: number) => value.toFixed(6);
    return {
      position: [centre - centre * cos, 0, centre - centre * sin]
        .map(fixed)
        .join('\\'),
      orientation: [cos, 0, sin, 0, 1, 0].map(fixed).join('\\'),
    };
  };
}

function encapsulatedPdf() {
  const pdf = Buffer.from(
    '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
      '2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
  );
  const sop = '1.2.840.10008.5.1.4.1.1.104.1';
  const instance = '1.2.826.0.1.3680043.10.999.2.3';
  return part10File(
    sop,
    instance,
    '1.2.840.10008.1.2.1',
    Buffer.concat([
      element('00080016', 'UI', sop),
      element('00080018', 'UI', instance),
      element('00080060', 'CS', 'DOC'),
      element('0020000d', 'UI', '1.2.826.0.1.3680043.10.999.2.1'),
      element('0020000e', 'UI', '1.2.826.0.1.3680043.10.999.2.2'),
      element('00420011', 'OB', pdf),
      element('00420012', 'LO', 'application/pdf'),
    ])
  );
}

/** Corpus files built in memory, keyed by the manifest's `generator`. */
export const GENERATED_CORPUS: Record<
  string,
  () => Uint8Array | Promise<Uint8Array>
> = {
  'oct-positioned': () => createSyntheticOCT(),
  'oct-slice-thickness-only': () =>
    createSyntheticOCT({
      omit: [
        ...unpositioned,
        '00180050',
        '00180088',
        '00200032',
        sharedMeasure('00180088'),
      ],
      set: { [sharedMeasure('00180050')]: '0.09375' },
    }),
  'oct-spacing-between-slices': () =>
    createSyntheticOCT({
      omit: [...unpositioned, '00180050', '00180088', '00200032'],
      set: { [sharedMeasure('00180050')]: '0.05' },
    }),
  'oct-radial': () =>
    createSyntheticOCT({
      volumetric: 'NO',
      frameCount: 6,
      scalars: bScans(6),
      framePlanes: radialPlanes(6),
    }),
  'oct-line': () =>
    createSyntheticOCT({
      volumetric: 'NO',
      frameCount: 1,
      scalars: bScans(1),
    }),
  'encapsulated-pdf': encapsulatedPdf,
  'htj2k-signed-frames': htj2kSignedFrames,
};

export const generatedName = (generator: string) =>
  `dicom-corpus-generated-${generator}.dcm`;
