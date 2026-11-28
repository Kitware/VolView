import { describe, expect, it } from 'vitest';
import { modalityLutBits, readModalityLut } from '../modalityLut';
import {
  modalityLutElement,
  pixelInstance,
  wordBytes,
} from '../../pixels/__tests__/pixelFixture';
import { IMPLICIT_LE, type NativePixelOptions } from '@/tests/nativePixelDicom';

const DATA = wordBytes([1000, 2000, 3000]);

const datasetWith = async (
  descriptor: number[] | undefined,
  options: NativePixelOptions = {},
  data: Uint8Array | null = DATA
) => {
  const { instance } = await pixelInstance({
    ...options,
    extra: [modalityLutElement(descriptor, data ?? undefined)],
  });
  return instance.dataset;
};

const XA = { sopClassUid: '1.2.840.10008.5.1.4.1.1.12.1' };

describe('modalityLutBits', () => {
  it.each([
    ['the descriptor third value', [3, 10, 16], {}, 16],
    ['fewer bits than the entries could hold', [3, 10, 12], {}, 12],
    ['nothing for a width of zero', [3, 10, 0], {}, undefined],
    ['nothing for a width past 16', [3, 10, 17], {}, undefined],
    ['nothing for an item with no LUT Descriptor', undefined, {}, undefined],
    ['nothing for X-Ray Angiographic', [3, 10, 16], XA, undefined],
  ])('gives %s', async (_name, descriptor, options, bits) => {
    expect(modalityLutBits(await datasetWith(descriptor, options))).toBe(bits);
  });
});

describe('readModalityLut', () => {
  it.each([
    ['Explicit VR', {}, 10, 10],
    ['Implicit VR', { transferSyntaxUid: IMPLICIT_LE }, 10, 10],
    [
      'Implicit VR with signed pixels, whose first mapped value past 0x7fff is negative',
      { transferSyntaxUid: IMPLICIT_LE, pixelRepresentation: 1 },
      0xffff,
      -1,
    ],
    [
      'Explicit VR with signed pixels, likewise',
      { pixelRepresentation: 1 },
      0xffff,
      -1,
    ],
    [
      'unsigned pixels, whose first mapped value stays large',
      {},
      0xffff,
      0xffff,
    ],
  ])('reads the table of %s', async (_name, options, first, firstMapped) => {
    expect(
      readModalityLut(await datasetWith([3, first, 16], options), true)
    ).toEqual({
      firstMapped,
      bits: 16,
      values: Uint16Array.of(1000, 2000, 3000),
    });
  });

  it.each([
    ['no LUT Descriptor', undefined, DATA],
    ['no LUT Data', [3, 10, 16], null],
  ])('finds no table in an item with %s', async (_name, descriptor, data) => {
    const dataset = await datasetWith(descriptor, {}, data);

    expect(readModalityLut(dataset, true)).toBeUndefined();
    expect(modalityLutBits(dataset)).toBeUndefined();
  });
});
