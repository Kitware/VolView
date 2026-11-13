import {
  buildSyntheticDicom,
  stripFileMeta,
  type SyntheticSliceOptions,
} from '../../specs/syntheticDicom';

export const fixtureBytes = (overrides: Partial<SyntheticSliceOptions> = {}) =>
  buildSyntheticDicom({
    studyUid: '1.2.826.0.1.3680043.10.999.20',
    seriesUid: '1.2.826.0.1.3680043.10.999.21',
    sopUid: '1.2.826.0.1.3680043.10.999.22',
    instanceNumber: 1,
    imageOrientationPatient: [1, 0, 0, 0, 1, 0],
    imagePositionPatient: [10, 20, 30],
    pixelSpacing: [2, 3],
    spacingBetweenSlices: 4,
    pixelValue: 5,
    rescaleSlope: 2,
    rescaleIntercept: -20,
    patientName: 'EXTRACTED^DICOM',
    ...overrides,
  });

/** Numeric text padding found in a legacy CT series. Binary values stay intact. */
export function nullPaddedFixtureBytes(
  overrides: Partial<SyntheticSliceOptions> = {}
) {
  const bytes = fixtureBytes(overrides);
  const view = new DataView(bytes.buffer);
  let offset = bytes.length - stripFileMeta(bytes).length;
  while (offset < bytes.length) {
    const vr = String.fromCharCode(bytes[offset + 4], bytes[offset + 5]);
    const long = vr === 'OB' || vr === 'OW';
    const header = long ? 12 : 8;
    const length = long
      ? view.getUint32(offset + 8, true)
      : view.getUint16(offset + 6, true);
    const end = offset + header + length;
    if ((vr === 'DS' || vr === 'IS') && bytes[end - 1] === 0x20)
      bytes[end - 1] = 0;
    offset = end;
  }
  return bytes;
}
