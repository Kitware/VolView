import { describe, expect, it } from 'vitest';
import { asPart10 } from '../part10Bytes';
import { readInstance } from '../../instance/readInstance';
import { fromBlob } from '../../source/byteSource';
import { concatBytes } from '../../utils';
import { stripFileMeta, stripPreamble } from '@/tests/specs/syntheticDicom';
import { buildSlice } from '@/tests/specs/dicomElementFixtures';

const never = () => new AbortController().signal;
const read = (bytes: Uint8Array) =>
  readInstance(fromBlob(new Blob([bytes.slice()])), never());

/** (0002,0010) written in implicit VR, as some pre-Part 10 files open. */
const implicitMetaElement = () => {
  const uid = new TextEncoder().encode('1.2.840.10008.1.2\0');
  const head = new Uint8Array(8);
  const view = new DataView(head.buffer);
  view.setUint16(0, 0x0002, true);
  view.setUint16(2, 0x0010, true);
  view.setUint32(4, uid.length, true);
  return concatBytes([head, uid]);
};

const cases = [
  ['without a preamble', () => stripPreamble(buildSlice())],
  ['as a bare explicit VR data set', () => stripFileMeta(buildSlice())],
  [
    'as a bare implicit VR data set',
    () => stripFileMeta(buildSlice({ implicitVr: true })),
  ],
  [
    'as a bare data set opening with implicit VR file meta',
    () =>
      concatBytes([
        implicitMetaElement(),
        stripFileMeta(buildSlice({ implicitVr: true })),
      ]),
  ],
] as const;

describe('asPart10', () => {
  it('passes a Part 10 file through unchanged', async () => {
    const bytes = buildSlice();
    expect(asPart10(await read(bytes), bytes)).toBe(bytes);
  });

  it.each(cases)(
    'writes a file stored %s as Part 10 with the same data set',
    async (_case, build) => {
      const bytes = build();
      const original = await read(bytes);
      const part10 = await read(asPart10(original, bytes));
      expect(part10.layout).toEqual({ preamble: true, fileMeta: true });
      expect(part10.transferSyntaxUid).toBe(original.transferSyntaxUid);
      const dataSetElements = (instance: typeof original) =>
        instance.dataset.elements.filter(({ tag }) => !tag.startsWith('0002'));
      expect(dataSetElements(part10)).toEqual(dataSetElements(original));
      expect(part10.pixelData?.length).toBe(original.pixelData?.length);
    }
  );
});
