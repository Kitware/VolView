import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { Tags } from '@/packages/dicom/core';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { useMessageStore } from '@/src/store/messages';
import {
  ALLOCATION_FAILURE,
  imageFactory,
  sliceFor,
  unallocatableFor,
} from './dicomImportFixtures';

const AXIAL = [1, 0, 0, 0, 1, 0];
const leaning = (theta: number) => [
  Math.cos(theta),
  0,
  Math.sin(theta),
  0,
  1,
  0,
];
const TILTED = leaning(0.0002);

// Slice 0 is the stray one, and is not the first its series walks.
const slice = (index: number, { stray = TILTED, pixelSpacing = '1\\1' } = {}) =>
  sliceFor({
    sop: index === 1 ? '1' : `2.${index}`,
    z: index * 5,
    orientation: (index === 0 ? stray : AXIAL).join('\\'),
    tags: { [Tags.BitsStored]: '8', [Tags.PixelSpacing]: pixelSpacing },
  });

const slices = (count: number, options?: Parameters<typeof slice>[1]) =>
  Array.from({ length: count }, (_, i) => slice(i, options));

describe('planned DICOM geometry in the image cache', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('builds on the axes most slices declare when the first spatial slice leans off them', () => {
    const { created, createImage } = imageFactory();
    const result = useDICOMStore().importInstances(slices(121), {
      createImage,
    });
    const [image] = created;

    expect(Object.keys(result.volumes)).toHaveLength(1);
    expect(useMessageStore().messages).toHaveLength(0);
    expect(image.getVtkImageData().getSpacing()).toEqual([1, 1, 5]);
    expect(image.getVtkImageData().getDirection()).toEqual([...AXIAL, 0, 0, 1]);
    expect(image.getVtkImageData().indexToWorld([0, 0, 120])[2]).toBe(600);
    image.dispose();
  });

  it('warns when a slice leans further off the volume axes than a sample can hide', () => {
    // Four samples 90mm apart: a 0.001 rad lean moves the far corner 0.36mm.
    const wide = { stray: leaning(0.001), pixelSpacing: '90\\90' };
    const { created, createImage } = imageFactory();
    useDICOMStore().importInstances(slices(5, wide), { createImage });
    const [image] = created;

    expect(image.getVtkImageData().getDirection()).toEqual([...AXIAL, 0, 0, 1]);
    expect(
      useMessageStore().messages.map((message) => message.options.details)
    ).toEqual([expect.stringContaining('not parallel to one another')]);
    image.dispose();
  });

  it('takes new axes on an incremental import and keeps the old ones when it fails', () => {
    const { created, createImage } = imageFactory();
    const store = useDICOMStore();
    const first = slice(0);
    store.importInstances([first], { createImage });
    const [image] = created;
    const direction = () => image.getVtkImageData().getDirection().slice(0, 6);
    expect(direction()).toEqual(TILTED);

    const rest = slices(121).slice(1);
    // A sibling collection of the series cannot be allocated.
    expect(() =>
      store.importInstances([...rest, unallocatableFor({ sop: 'scout' })], {
        createImage,
      })
    ).toThrow(ALLOCATION_FAILURE);
    expect(image.getInstances()).toEqual([first]);
    expect(direction()).toEqual(TILTED);

    store.importInstances(rest, { createImage });
    expect(direction()).toEqual(AXIAL);
    expect(image.getVtkImageData().getSpacing()).toEqual([1, 1, 5]);
    image.dispose();
  });
});
