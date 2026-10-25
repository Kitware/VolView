import { describe, expect, it } from 'vitest';
import {
  EXPLICIT_VR_LITTLE_ENDIAN,
  IMPLICIT_VR_LITTLE_ENDIAN,
  PART_10_HEADER_LENGTH,
  sniffDicomLayout,
} from '@/src/io/dicomLayout';
import { stripFileMeta, stripPreamble } from '@/tests/specs/syntheticDicom';
import { buildSlice } from './readDicomTagsFixtures';

const head = (bytes: Uint8Array) => bytes.subarray(0, PART_10_HEADER_LENGTH);

describe('sniffDicomLayout', () => {
  it('reads a Part 10 file as preamble and file meta information', () => {
    expect(sniffDicomLayout(head(buildSlice()))).toEqual({
      preamble: true,
      fileMeta: true,
    });
  });

  it('reads file meta information at the first byte when the preamble is missing', () => {
    expect(sniffDicomLayout(head(stripPreamble(buildSlice())))).toEqual({
      preamble: false,
      fileMeta: true,
    });
  });

  it('assumes explicit VR little endian for a bare data set that spells VRs', () => {
    expect(sniffDicomLayout(head(stripFileMeta(buildSlice())))).toEqual({
      preamble: false,
      fileMeta: false,
      transferSyntaxUid: EXPLICIT_VR_LITTLE_ENDIAN,
    });
  });

  it('assumes implicit VR little endian for a bare data set that does not', () => {
    expect(
      sniffDicomLayout(head(stripFileMeta(buildSlice({ implicitVr: true }))))
    ).toEqual({
      preamble: false,
      fileMeta: false,
      transferSyntaxUid: IMPLICIT_VR_LITTLE_ENDIAN,
    });
  });

  it('judges a first element from fewer bytes than a preamble takes', () => {
    expect(
      sniffDicomLayout(stripFileMeta(buildSlice()).subarray(0, 8))
    ).toMatchObject({ fileMeta: false });
  });

  it.each([
    ['all zeros', new Uint8Array(512)],
    [
      'a first element outside group 0008',
      new Uint8Array([0x10, 0x00, 0x10, 0x00, 0x50, 0x4e, 0, 0]),
    ],
    ['letters all the way down', new Uint8Array(256).fill(0x41)],
    ['too few bytes for an element', new Uint8Array([0x08, 0x00, 0x16])],
  ])('rejects %s', (_case, bytes) => {
    expect(() => sniffDicomLayout(bytes)).toThrow(/Not DICOM/);
  });
});
