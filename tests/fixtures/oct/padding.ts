import fs from 'node:fs';
import dicomParser from 'dicom-parser';

function paddingElement() {
  const bytes = Buffer.alloc(10);
  bytes.writeUInt16LE(0x0028, 0);
  bytes.writeUInt16LE(0x0120, 2);
  bytes.write('US', 4);
  bytes.writeUInt16LE(2, 6);
  bytes.writeUInt16LE(65535, 8);
  return bytes;
}

/** Declared missing data added to a public raster; original reflectivity retained elsewhere. */
export function paddedPublicOCT(sourcePath: string) {
  const original = fs.readFileSync(sourcePath);
  const source = dicomParser.parseDicom(original);
  const next = Object.keys(source.elements)
    .sort()
    .find((tag) => tag > 'x00280120')!;
  const element = source.elements[next];
  const longVR = [
    'OB',
    'OD',
    'OF',
    'OL',
    'OW',
    'SQ',
    'UC',
    'UN',
    'UR',
    'UT',
  ].includes(element.vr!);
  const position = element.dataOffset - (longVR ? 12 : 8);
  const bytes = Buffer.concat([
    original.subarray(0, position),
    paddingElement(),
    original.subarray(position),
  ]);
  const dataset = dicomParser.parseDicom(bytes);
  const width = dataset.uint16('x00280011')!;
  const depth = dataset.uint16('x00280010')!;
  const offset = dataset.elements.x7fe00010.dataOffset;
  const pixelOffset = (x: number, y: number, z: number) =>
    offset + 2 * ((z * depth + y) * width + x);
  for (const [x, z] of [
    [0, 0],
    [5, 12],
  ]) {
    for (let y = 0; y < depth; y++)
      bytes.writeUInt16LE(65535, pixelOffset(x, y, z));
  }
  bytes.writeUInt16LE(65535, pixelOffset(10, 0, 10));
  const slope = Number(dataset.string('x00281053') ?? 1);
  const intercept = Number(dataset.string('x00281052') ?? 0);
  const points = [
    { x: 64, z: 0 },
    { x: 10, z: 10 },
    { x: 5, z: 13 },
  ];
  const mean = points.map(({ x, z }) => {
    const samples = Array.from({ length: depth }, (_, y) =>
      bytes.readUInt16LE(pixelOffset(x, y, z))
    ).filter((value) => value !== 65535);
    return Math.fround(
      samples.reduce((sum, value) => sum + value * slope + intercept, 0) /
        samples.length
    );
  });
  return { bytes, points, mean };
}
