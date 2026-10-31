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

/** Declared missing data added to a synthetic raster; original intensity retained elsewhere. */
export function paddedSyntheticOCT(original: Uint8Array) {
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
  return { bytes };
}
