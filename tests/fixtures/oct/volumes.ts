import dicomParser from 'dicom-parser';
import { deflateRawSync, gzipSync } from 'node:zlib';
import reference from './reference.json';
import { overwriteDicomString, syntheticScalars } from './dicom';
import { elemShort } from '../../specs/syntheticDicom';

/** Preserve a Part 10 dataset while changing only its transfer syntax. */
export function deflatedExplicitVR(
  source: Uint8Array,
  deflate: (dataset: Uint8Array) => Uint8Array = deflateRawSync
) {
  const data = dicomParser.parseDicom(source, { untilTag: 'x7fe00010' });
  const position = Math.max(
    ...Object.values(data.elements)
      .filter((element) => element.tag.startsWith('x0002'))
      .map((element) => element.dataOffset + element.length)
  );
  const syntax = data.elements.x00020010;
  const uid = Buffer.from('1.2.840.10008.1.2.1.99', 'ascii');
  const syntaxElement = elemShort(2, 16, 'UI', uid);
  let prefix = Buffer.concat([
    source.subarray(0, syntax.dataOffset - 8),
    syntaxElement,
    source.subarray(syntax.dataOffset + syntax.length, position),
  ]);
  const groupLength = data.elements.x00020000;
  if (!groupLength) {
    const lengthElement = elemShort(2, 0, 'UL', new Uint8Array(4));
    prefix = Buffer.concat([
      prefix.subarray(0, 132),
      lengthElement,
      prefix.subarray(132),
    ]);
  }
  const lengthOffset = groupLength?.dataOffset ?? 140;
  prefix.writeUInt32LE(prefix.length - (lengthOffset + 4), lengthOffset);
  const deflated = deflate(source.subarray(position));
  // DICOM requires an even-length deflated stream with a trailing NULL if needed.
  return Buffer.concat([prefix, deflated, Buffer.alloc(deflated.length % 2)]);
}

export function nonOCTDicom(source: Uint8Array) {
  const bytes = Buffer.from(source);
  const dicom = dicomParser.parseDicom(bytes);
  for (const [tag, value] of [
    ['x00020002', '1.2.840.10008.5.1.4.1.1.7.3'],
    ['x00080016', '1.2.840.10008.5.1.4.1.1.7.3'],
    ['x00080060', 'CT'],
  ])
    overwriteDicomString(dicom, tag, value, tag === 'x00080060' ? 0x20 : 0);
  return bytes;
}

type Volume = {
  scalars: Uint16Array;
  dimensions: readonly number[];
  spacing: readonly number[];
  origin?: readonly number[];
  direction?: readonly number[];
};
const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function scalarBytes(scalars: Uint16Array) {
  const bytes = Buffer.alloc(scalars.byteLength);
  scalars.forEach((value, index) => bytes.writeUInt16LE(value, index * 2));
  return bytes;
}

export function createNrrdVolume({
  scalars,
  dimensions,
  spacing,
  origin = [0, 0, 0],
  direction = identity,
  units = ['mm', 'mm', 'mm'],
  metadata = {},
}: Volume & { units?: string[]; metadata?: Record<string, string> }) {
  const vectors = spacing.map(
    (step, axis) =>
      '(' +
      direction
        .slice(axis * 3, axis * 3 + 3)
        .map((n) => n * step)
        .join(',') +
      ')'
  );
  const header = [
    'NRRD0005',
    'type: unsigned short',
    'dimension: 3',
    'sizes: ' + dimensions.join(' '),
    'space: left-posterior-superior',
    'space directions: ' + vectors.join(' '),
    ...(units.length
      ? ['space units: ' + units.map((unit) => '"' + unit + '"').join(' ')]
      : []),
    'space origin: (' + origin.join(',') + ')',
    'endian: little',
    'encoding: gzip',
    ...Object.entries(metadata).map(([key, value]) => key + ':=' + value),
    '',
    '',
  ].join('\n');
  return Buffer.concat([Buffer.from(header), gzipSync(scalarBytes(scalars))]);
}

export function createNiftiVolume({
  scalars,
  dimensions,
  spacing,
  origin = [0, 0, 0],
  direction = identity,
  units = 2,
  sformCode = 1,
}: Volume & { units?: number; sformCode?: number }) {
  const header = Buffer.alloc(352);
  header.writeInt32LE(348, 0);
  [3, ...dimensions, 1, 1, 1, 1].forEach((value, index) =>
    header.writeInt16LE(value, 40 + index * 2)
  );
  header.writeInt16LE(512, 70);
  header.writeInt16LE(16, 72);
  [1, ...spacing, 0, 0, 0, 0].forEach((value, index) =>
    header.writeFloatLE(value, 76 + index * 4)
  );
  header.writeFloatLE(352, 108);
  header.writeUInt8(units, 123);
  header.writeInt16LE(sformCode, 254);
  // NIfTI stores RAS; the input geometry uses the same LPS convention as NRRD.
  [0, 1, 2].forEach((row) => {
    const sign = row < 2 ? -1 : 1;
    const values = spacing.map(
      (step, axis) => sign * direction[axis * 3 + row] * step
    );
    [...values, sign * origin[row]].forEach((value, column) =>
      header.writeFloatLE(value, 280 + row * 16 + column * 4)
    );
  });
  header.write('n+1\0', 344, 'ascii');
  return Buffer.concat([header, scalarBytes(scalars)]);
}

/** ASCII VTK image data, for grids NRRD and NIfTI cannot express such as offset extents. */
export function createVtiVolume({
  values,
  extent,
  spacing = [1, 1, 1],
  origin = [0, 0, 0],
  direction,
  type,
  name = 'intensity',
  components,
}: {
  values: ArrayLike<number>;
  extent: readonly number[];
  spacing?: readonly number[];
  origin?: readonly number[];
  direction?: readonly number[];
  type: 'UInt8' | 'UInt16' | 'Float32';
  name?: string;
  components?: number;
}) {
  const range = extent.join(' ');
  return (
    '<VTKFile type="ImageData" version="1.0" byte_order="LittleEndian">' +
    `<ImageData WholeExtent="${range}" Origin="${origin.join(' ')}" Spacing="${spacing.join(' ')}"` +
    (direction ? ` Direction="${direction.join(' ')}"` : '') +
    `><Piece Extent="${range}"><PointData Scalars="${name}">` +
    `<DataArray type="${type}" Name="${name}"` +
    (components ? ` NumberOfComponents="${components}"` : '') +
    ' format="ascii">' +
    Array.from(values).join(' ') +
    '</DataArray></PointData><CellData/></Piece></ImageData></VTKFile>'
  );
}

export function syntheticOCTGrid() {
  const [width, depth, frames] = reference.size;
  const [sx, sy, sz] = reference.spacing;
  const source = syntheticScalars();
  const scalars = new Uint16Array(source.length);
  for (let y = 0; y < depth; y++)
    for (let z = 0; z < frames; z++)
      for (let x = 0; x < width; x++)
        scalars[(y * frames + z) * width + x] =
          source[(z * depth + y) * width + x];
  return {
    scalars,
    dimensions: [width, frames, depth],
    spacing: [sx, sz, sy],
    direction: [1, 0, 0, 0, 0, 1, 0, 1, 0],
  };
}

export function syntheticOCTVolume(format: 'nrrd' | 'nii', unitsKnown = true) {
  const volume = syntheticOCTGrid();
  return format === 'nrrd'
    ? createNrrdVolume({
        ...volume,
        units: unitsKnown ? ['mm', 'mm', 'mm'] : [],
      })
    : createNiftiVolume({ ...volume, units: unitsKnown ? 2 : 0 });
}

export function syntheticMask(illustrative = false) {
  const [width, depth, frames] = reference.size;
  const scalars = new Uint16Array(width * depth * frames);
  for (let z = 0; z < frames; z++)
    for (let x = 0; x < width; x++) {
      if (illustrative) {
        const bottom = Math.round(
          145 +
            26 * Math.sin((Math.PI * x) / (width - 1)) +
            2 * Math.sin((Math.PI * z) / (frames - 1))
        );
        const thickness =
          ((x - 76) / 12) ** 2 + ((z - 16) / 3) ** 2 <= 1 ? 2 : 5;
        for (let y = bottom - thickness + 1; y <= bottom; y++)
          scalars[(z * depth + y) * width + x] = 1;
      } else {
        for (let y = 100; y < (x < 43 ? 102 : x < 86 ? 104 : 100); y++)
          scalars[(z * depth + y) * width + x] = 1;
        for (let y = 110; y < 115; y++)
          scalars[(z * depth + y) * width + x] = 2;
      }
    }
  return createNrrdVolume({
    scalars,
    dimensions: reference.size,
    spacing: reference.spacing,
    metadata: illustrative
      ? {
          Segment0_LabelValue: '1',
          Segment0_Name: 'Synthetic retinal layer',
          Segment0_Color:
            '0.13725490196078433 0.8431372549019608 0.7450980392156863',
        }
      : {
          Segment0_LabelValue: '1',
          Segment0_Name: 'Synthetic retinal band',
          Segment0_Color: '1 0 0',
          Segment1_LabelValue: '2',
          Segment1_Name: 'Alternative synthetic band',
          Segment1_Color: '0 1 0',
        },
  });
}
