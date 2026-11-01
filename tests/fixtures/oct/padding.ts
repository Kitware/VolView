import dicomParser from 'dicom-parser';
import { elemShort, LONG_FORM_VRS } from '../../specs/syntheticDicom';

function paddingElement() {
  return elemShort(0x0028, 0x0120, 'US', Uint8Array.of(255, 255));
}

/** Declared missing data added to a synthetic raster; original intensity retained elsewhere. */
export function paddedSyntheticOCT(original: Uint8Array) {
  const source = dicomParser.parseDicom(original);
  const next = Object.keys(source.elements)
    .sort()
    .find((tag) => tag > 'x00280120')!;
  const element = source.elements[next];
  const longVR = LONG_FORM_VRS.has(element.vr!);
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
