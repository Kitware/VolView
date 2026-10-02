import fs from 'node:fs';
import dicomParser from 'dicom-parser';
import { gzipSync } from 'node:zlib';

export function nonOCTDicom(sourcePath: string) {
  const bytes = fs.readFileSync(sourcePath);
  const dicom = dicomParser.parseDicom(bytes);
  for (const [tag, value] of [
    ['x00020002', '1.2.840.10008.5.1.4.1.1.7.3'],
    ['x00080016', '1.2.840.10008.5.1.4.1.1.7.3'],
    ['x00080060', 'CT'],
  ]) {
    const element = dicom.elements[tag];
    if (value.length > element.length)
      throw new Error('Replacement DICOM tag is too long');
    const target = bytes.subarray(
      element.dataOffset,
      element.dataOffset + element.length
    );
    target.fill(tag === 'x00080060' ? 32 : 0);
    target.write(value, 'ascii');
  }
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

// Preserve public pixels and physical geometry while moving A-lines to grid Z.
export function publicOCTGrid(sourcePath: string) {
  const bytes = fs.readFileSync(sourcePath);
  const dicom = dicomParser.parseDicom(bytes);
  const width = dicom.uint16('x00280011')!;
  const depth = dicom.uint16('x00280010')!;
  const frames = Number(dicom.string('x00280008'));
  const spacing = dicom.string('x00280030')!.split('\\').map(Number);
  const pixels = new DataView(
    bytes.buffer,
    bytes.byteOffset + dicom.elements.x7fe00010.dataOffset,
    width * depth * frames * 2
  );
  const scalars = new Uint16Array(width * depth * frames);
  for (let y = 0; y < depth; y++)
    for (let z = 0; z < frames; z++)
      for (let x = 0; x < width; x++)
        scalars[(y * frames + z) * width + x] = pixels.getUint16(
          ((z * depth + y) * width + x) * 2,
          true
        );
  return {
    scalars,
    dimensions: [width, frames, depth],
    spacing: [spacing[1], Number(dicom.string('x00180088')), spacing[0]],
    direction: [1, 0, 0, 0, 0, 1, 0, 1, 0],
  };
}

export function publicOCTVolume(
  sourcePath: string,
  format: 'nrrd' | 'nii',
  unitsKnown = true
) {
  const volume = publicOCTGrid(sourcePath);
  return format === 'nrrd'
    ? createNrrdVolume({
        ...volume,
        units: unitsKnown ? ['mm', 'mm', 'mm'] : [],
      })
    : createNiftiVolume({ ...volume, units: unitsKnown ? 2 : 0 });
}
