import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  boundMasks,
  inMemoryArtifactIO,
  makeImage,
  mintSegment,
  seatImage,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import JSZip from 'jszip';

import { CATEGORICAL_COLORS } from '@/src/config';
import { applyPreStateConfig, config } from '@/src/io/import/configJson';
import type { Manifest } from '@/src/io/state-file/schema';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentStore } from '@/src/segmentation/segments';
import { listMasks } from '@/src/segmentation/model';
import { importLabelmapImage, toLabelMap } from '@/src/segmentation/io/import';
import { defer } from '@/src/utils';

const appearanceOf = (segment: { segmentId: string }) =>
  useSegmentStore().segments.appearanceOf(segment.segmentId);

const VOXEL_COUNT = 4 * 4 * 4;

const offset = (i: number, j: number, k: number) => i + j * 4 + k * 16;

function labelValues() {
  const values = new Uint8Array(VOXEL_COUNT);
  values[offset(1, 1, 1)] = 1;
  values[offset(2, 1, 1)] = 1;
  values[offset(3, 3, 3)] = 2;
  return values;
}

const categorical = (index: number) => [
  ...CATEGORICAL_COLORS[index % CATEGORICAL_COLORS.length],
  255,
];

const segmentsOf = (imageId: string) => {
  const segmentation = store().getSegmentationForImage(imageId);
  return segmentation ? listMasks(segmentation) : [];
};

const describedBy = (imageId: string) =>
  segmentsOf(imageId).map((segment) => ({
    name: appearanceOf(segment).name,
    color: [...appearanceOf(segment).color],
  }));

async function seatConvertible() {
  await seatImage('parent-img', { name: 'CT' });
  await seatImage('child-img', {
    name: 'Tumor.seg.nrrd',
    values: labelValues(),
  });
}

async function convertedColors() {
  await seatConvertible();
  await store().convertImageToLabelmap('child-img', 'parent-img');
  return segmentsOf('parent-img').map((segment) => [
    ...appearanceOf(segment).color,
  ]);
}

describe('importing a labelmap onto a parent image', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('splits an imported labelmap into one bounded mask per label value', async () => {
    await seatConvertible();

    await store().convertImageToLabelmap('child-img', 'parent-img');

    const segments = segmentsOf('parent-img');
    expect(useSegmentStore().segments.selectedSegmentId.value).toBe(
      segments[0].segmentId
    );
    expect(segments.map(appearanceOf)).toEqual([
      expect.objectContaining({
        name: 'Tumor 1',
        visible: true,
        locked: false,
      }),
      expect.objectContaining({
        name: 'Tumor 2',
        visible: true,
        locked: false,
      }),
    ]);

    const bindings = segments.map(
      (segment) => segment.representations.labelmap!
    );
    // Each mask is cropped to the box its own value spans, not the parent's grid.
    expect([...bindings[0].extent]).toEqual([1, 2, 1, 1, 1, 1]);
    expect([...bindings[1].extent]).toEqual([3, 3, 3, 3, 3, 3]);
    expect(store().maskVoxels(segments[0].id).image().getDimensions()).toEqual([
      2, 1, 1,
    ]);
  });

  it('hands back the source label value every created segment came from', async () => {
    await seatConvertible();

    const created = await store().convertImageToLabelmap(
      'child-img',
      'parent-img'
    );

    // One entry per component of the source image; the common case is one.
    expect(created).toHaveLength(1);
    expect(created[0].map((entry) => entry.sourceValue)).toEqual([1, 2]);
    expect(created[0].map((entry) => entry.maskId)).toEqual(
      segmentsOf('parent-img').map((segment) => segment.id)
    );
  });

  // A conversion is joined by the child image AND the parent it is going onto.
  // Two parents are two conversions: the second caller must be handed its own
  // parent's masks, not the first parent's.
  it('converts one child onto two parents at once', async () => {
    await seatImage('parent-a', { name: 'CT A' });
    await seatImage('parent-b', { name: 'CT B' });
    await seatImage('child-img', {
      name: 'Tumor.seg.nrrd',
      values: labelValues(),
    });

    const [ontoA, ontoB] = await Promise.all([
      store().convertImageToLabelmap('child-img', 'parent-a'),
      store().convertImageToLabelmap('child-img', 'parent-b'),
    ]);

    expect(ontoB).not.toBe(ontoA);
    expect(segmentsOf('parent-a').map((segment) => segment.id)).toEqual(
      ontoA[0].map((entry) => entry.maskId)
    );
    expect(segmentsOf('parent-b').map((segment) => segment.id)).toEqual(
      ontoB[0].map((entry) => entry.maskId)
    );
    expect(
      segmentsOf('parent-b').map((segment) => appearanceOf(segment).name)
    ).toEqual(['Tumor 1', 'Tumor 2']);
  });

  it('refuses to convert an image into a labelmap of itself', async () => {
    await seatConvertible();

    await expect(
      store().convertImageToLabelmap('parent-img', 'parent-img')
    ).rejects.toThrow(/itself/i);
  });

  it('refuses a child whose bounds miss the parent entirely', async () => {
    await seatImage('parent-img', { name: 'CT' });
    await seatImage('far-img', {
      name: 'Far.seg.nrrd',
      values: labelValues(),
      origin: [1000, 1000, 1000],
    });

    await expect(
      store().convertImageToLabelmap('far-img', 'parent-img')
    ).rejects.toThrow(/intersect/i);
  });

  it('creates nothing for an all-background labelmap', async () => {
    await seatImage('parent-img', { name: 'CT' });
    await seatImage('child-img', { name: 'Empty.seg.nrrd' });

    await store().convertImageToLabelmap('child-img', 'parent-img');

    expect(segmentsOf('parent-img')).toEqual([]);
    expect(boundMasks()).toEqual([]);
  });

  it.each([
    ['foreground', labelValues()],
    ['background only', new Uint8Array(VOXEL_COUNT)],
  ])(
    'creates no records when the parent is removed during %s decoding',
    async (_kind, values) => {
      await seatImage('parent-img', { name: 'CT' });
      await seatImage('healthy-img', { name: 'MR' });
      await seatImage('child-img', { name: 'Tumor.seg.nrrd', values });
      const decoding = defer<void>();
      const started = defer<void>();

      const conversion = importLabelmapImage('child-img', 'parent-img', {
        decode: async () => {
          started.resolve();
          await decoding.promise;
          return values.some(Boolean)
            ? [1, 2].map((value) => ({
                value,
                name: `Tumor ${value}`,
                color: [255, 0, 0, 255] as [number, number, number, number],
                visible: true,
              }))
            : [];
        },
        split: (labelmap, descriptors) =>
          store()
            .splitLabelmapIntoMasks('parent-img', labelmap, descriptors)
            .map(({ id }) => id),
      });
      await started.promise;

      useImageCacheStore().removeImage('parent-img');
      decoding.resolve();

      await expect(conversion).rejects.toThrow(/no longer loaded/i);
      expect(store().getSegmentationForImage('parent-img')).toBeUndefined();
      expect(useImageCacheStore().imageById['healthy-img']).toBeDefined();
      expect(useSegmentStore().segments.segmentList.value).toEqual([]);
      expect(boundMasks()).toEqual([]);
    }
  );

  it('tells the caller how many voxels lost a label past 16 bits', async () => {
    await seatImage('parent-img', { name: 'CT' });
    const values = new Uint32Array(VOXEL_COUNT);
    values[offset(1, 1, 1)] = 1;
    values[offset(2, 1, 1)] = 70000;
    values[offset(3, 3, 3)] = 70000;
    await seatImage('child-img', { name: 'Atlas.nrrd', values });
    const excluded: number[] = [];

    await importLabelmapImage('child-img', 'parent-img', {
      decode: async () => [],
      split: () => [],
      excluded: (voxels) => excluded.push(voxels),
    });

    expect(excluded).toEqual([2]);
  });

  // 'Segment 1' says nothing about what was imported. The file stem is the only
  // name a descriptor-less labelmap carries, and it reaches the panel and the
  // .seg.nrrd header a save writes.
  it('names descriptor-less segments after the imported file', async () => {
    await seatImage('parent-img', { name: 'CT' });
    await seatImage('child-img', { name: 'liver.nrrd', values: labelValues() });

    await store().convertImageToLabelmap('child-img', 'parent-img');

    expect(
      segmentsOf('parent-img').map((segment) => appearanceOf(segment).name)
    ).toEqual(['liver 1', 'liver 2']);
  });

  it('numbers nothing when the import holds a single label value', async () => {
    const single = new Uint8Array(VOXEL_COUNT);
    single[offset(1, 1, 1)] = 4;
    await seatImage('parent-img', { name: 'CT' });
    await seatImage('child-img', { name: 'liver.nrrd', values: single });

    await store().convertImageToLabelmap('child-img', 'parent-img');

    expect(
      segmentsOf('parent-img').map((segment) => appearanceOf(segment).name)
    ).toEqual(['liver']);
  });

  it('decodes a labelmap the restore path already holds', async () => {
    // `deserialize` decodes a migrated artifact's buffer directly, so the decode
    // stays reachable as store API and not only through the conversion.
    const decoded = await store().decodeSegments(
      undefined,
      toLabelMap(makeImage({ values: labelValues() })).labelmap
    );

    expect(decoded.map((segment) => segment.value)).toEqual([1, 2]);
    expect(decoded.map((segment) => segment.name)).toEqual([
      'Segment 1',
      'Segment 2',
    ]);
    expect(decoded.every((segment) => segment.visible)).toBe(true);
  });

  it('overlays embedded .seg.nrrd metadata onto the enumerated values', async () => {
    await seatImage('parent-img', { name: 'CT' });
    await seatImage('child-img', {
      name: 'Tumor.seg.nrrd',
      values: labelValues(),
      headerMetadata: new Map([
        ['Segment0_LabelValue', '2'],
        ['Segment0_Name', 'Tumor core'],
        ['Segment0_Color', '1 0 0'],
      ]),
    });

    await store().convertImageToLabelmap('child-img', 'parent-img');

    // Merge, not replace: the described value takes the embedded name and
    // color, the undescribed one keeps its default.
    expect(describedBy('parent-img')).toEqual([
      { name: 'Tumor 1', color: categorical(0) },
      { name: 'Tumor core', color: [255, 0, 0, 255] },
    ]);
  });
});

describe('a .seg.nrrd header declaring a segment it leaves empty', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const HEADER = new Map([
    ['Segment0_LabelValue', '1'],
    ['Segment0_Name', 'Liver'],
    ['Segment0_Color', '1 0 0'],
    ['Segment1_LabelValue', '2'],
    ['Segment1_Name', 'Spleen'],
    ['Segment1_Color', '0 0 1'],
  ]);

  const LIVER = { name: 'Liver', color: [255, 0, 0, 255] };
  const SPLEEN = { name: 'Spleen', color: [0, 0, 255, 255] };

  it('shows the declaration as an empty row', async () => {
    const values = new Uint8Array(VOXEL_COUNT);
    values[offset(1, 1, 1)] = 1;
    await seatImage('parent-img', { name: 'CT' });
    await seatImage('child-img', {
      name: 'Liver.seg.nrrd',
      values,
      headerMetadata: HEADER,
    });

    await store().convertImageToLabelmap('child-img', 'parent-img');

    expect(describedBy('parent-img')).toEqual([LIVER, SPLEEN]);
  });

  // A declaration is one bin however many components the file has: a value
  // some component carried is that component's segment, so it must not come
  // back a second time as an empty twin of itself, and a value no component
  // carried is one empty row, not one per component.
  it('declares it once across the components of one file', async () => {
    const values = new Uint8Array(VOXEL_COUNT * 2);
    values[offset(1, 1, 1) * 2] = 1;
    await seatImage('parent-img', { name: 'CT' });
    await seatImage('child-img', {
      name: 'Liver.seg.nrrd',
      values,
      headerMetadata: HEADER,
      components: 2,
    });

    await store().convertImageToLabelmap('child-img', 'parent-img');

    expect(describedBy('parent-img')).toEqual([LIVER, SPLEEN]);
    // The declared value no component carried is a real mask record covering
    // nothing, exactly as it is on the result path.
    const spleen = segmentsOf('parent-img')[1];
    expect(store().maskVoxels(spleen.id).scalars()).toHaveLength(0);
  });
});

describe('the decode color cursor', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('starts a session at the first categorical colors', async () => {
    await seatConvertible();

    await store().convertImageToLabelmap('child-img', 'parent-img');

    expect(
      segmentsOf('parent-img').map((segment) => [
        ...appearanceOf(segment).color,
      ])
    ).toEqual([categorical(0), categorical(1)]);
  });

  it('decodes the same colors however many segments the session has created', async () => {
    // The segment-creation cursor and the decode cursor stay separate: a
    // decoded catalog has to be reproducible regardless of what else the
    // session has made.
    await seatImage('other-img', { name: 'MR' });
    const other = store().ensureSegmentationForImage('other-img');
    ['A', 'B', 'C'].forEach((name) =>
      store().createMask(other.id, mintSegment({ name }))
    );
    expect(await convertedColors()).toEqual([categorical(0), categorical(1)]);
  });

  it('advances within a session and resets with the pinia instance', async () => {
    await seatImage('parent-a', { name: 'CT A' });
    await seatImage('parent-b', { name: 'CT B' });
    await seatImage('child-a', { name: 'A.seg.nrrd', values: labelValues() });
    await seatImage('child-b', { name: 'B.seg.nrrd', values: labelValues() });

    await store().convertImageToLabelmap('child-a', 'parent-a');
    await store().convertImageToLabelmap('child-b', 'parent-b');

    expect(
      segmentsOf('parent-b').map((segment) => [...appearanceOf(segment).color])
    ).toEqual([categorical(2), categorical(3)]);

    setActivePinia(createPinia());

    expect(await convertedColors()).toEqual([categorical(0), categorical(1)]);
  });
});

describe('the labelmap save format', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('defaults to vti on the segmentation store', () => {
    expect(store().saveFormat).toBe('vti');
  });

  it('takes the format a config manifest asks for', async () => {
    await applyPreStateConfig(
      config.parse({ io: { segmentationSaveFormat: 'nrrd' } })
    );

    expect(store().saveFormat).toBe('nrrd');
  });

  it('writes the session archive through the format it holds', async () => {
    await seatConvertible();
    await store().convertImageToLabelmap('child-img', 'parent-img');
    store().saveFormat = 'nrrd';

    const io = inMemoryArtifactIO();
    const manifest = {} as Manifest;
    await store().serialize({ zip: new JSZip(), manifest }, io);

    expect(io.formats).toEqual(['nrrd', 'nrrd']);
    expect(
      manifest
        .segmentations!.flatMap((segmentation) => segmentation.masks)
        .every((mask) => mask.representations.labelmap!.path!.endsWith('.nrrd'))
    ).toBe(true);
  });
});
