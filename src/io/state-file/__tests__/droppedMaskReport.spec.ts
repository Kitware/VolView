import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

import {
  seatImage as seatSizedImage,
  seatSpecImage as seatImage,
  inMemoryArtifactIO,
  mintSegment,
  manifestForImages,
  serializeToStateFiles,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { ManifestSchema } from '@/src/io/state-file/schema';

// ---------------------------------------------------------------------------
// A restore drops a mask it cannot give an identity to. The module's policy is
// that no drop is silent, so each of the three reasons has to reach the report
// the caller surfaces, naming the mask it lost.
// ---------------------------------------------------------------------------

const buildScene = async () => {
  await seatImage('img-1', 'CT A');
  const segmentation = store().ensureSegmentationForImage('img-1');
  ['Liver', 'Tumor'].forEach((name) => {
    const mask = store().createMask(segmentation.id, mintSegment({ name }));
    store().ensureLabelmapBinding(mask.id);
  });
};

const restoreTampered = async (
  tamper: (parsed: any) => void,
  segmentIdMapFor: (parsed: any) => Record<string, string> = (parsed) =>
    useSegmentStore().deserialize(parsed).segmentIdMap,
  dataIDMap: Record<string, string> = { 'img-1': 'new-1' }
) => {
  await buildScene();
  const io = inMemoryArtifactIO();
  const { parsed, stateFiles } = await serializeToStateFiles(
    manifestForImages(['img-1']),
    io,
    tamper
  );

  setActivePinia(createPinia());
  await seatImage('new-1', 'CT A');
  const result = await useSegmentationStore().deserialize({
    manifest: parsed,
    stateFiles,
    dataIDMap,
    segmentIdMap: segmentIdMapFor(parsed),
    io,
  });
  return {
    skipped: result.skipped,
    masks: store().getSegmentationForImage('new-1')?.order ?? [],
  };
};

// Three masks bound to one artifact's values 1 to 3; the second names a
// segment the file never lists.
const restoreArtifactMasks = async (order: string[]) => {
  const labels = await seatSizedImage('labels', {
    dimensions: [4, 1, 1],
    values: new Uint8Array([1, 2, 3, 0]),
  });
  await seatSizedImage('parent', { dimensions: [4, 1, 1] });
  const maskIds = ['m1', 'm2', 'm3'];
  const manifest = ManifestSchema.parse(
    manifestForImages(['parent'], {
      segments: ['s1', 's3'].map((id) => ({
        id,
        name: id,
        color: [255, 0, 0, 255],
      })),
      segmentations: [
        {
          id: 'wire',
          name: 'CT',
          parentImage: 'parent',
          order,
          masks: maskIds.map((id, index) => ({
            id,
            segmentId: `s${index + 1}`,
            representations: {
              labelmap: {
                artifactId: 'labels',
                sourceValue: index + 1,
                extent: [0, -1, 0, -1, 0, -1],
              },
            },
          })),
        },
      ],
      segmentationArtifacts: [
        {
          id: 'labels',
          name: 'labels.nii.gz',
          parentImage: 'parent',
          path: 'labels.vti',
        },
      ],
    })
  );
  const result = await useSegmentationStore().deserialize({
    manifest,
    stateFiles: [
      { archivePath: 'labels.vti', file: new File([], 'labels.vti') },
    ],
    dataIDMap: { parent: 'parent' },
    segmentIdMap: useSegmentStore().deserialize(manifest).segmentIdMap,
    io: { read: async () => ({ image: labels }), write: async () => '' },
  });
  return {
    skipped: result.skipped,
    masks: store().getSegmentationForImage('parent')?.order ?? [],
  };
};

describe('masks dropped during restore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('reports a mask whose segment the file never names', async () => {
    const { skipped, masks } = await restoreTampered(
      (parsed) => {
        delete parsed.segments;
      },
      () => ({})
    );

    expect(masks).toHaveLength(0);
    expect(skipped.map(({ reason }) => reason)).toEqual([
      'its segment is not in the file',
      'its segment is not in the file',
    ]);
    expect(skipped.every(({ name }) => name.length > 0)).toBe(true);
  });

  it('reports a mask whose segment did not restore', async () => {
    const { skipped, masks } = await restoreTampered(
      () => {},
      (parsed) =>
        Object.fromEntries(
          parsed.segments.map((segment: any) => [segment.id, 'no-such-segment'])
        )
    );

    expect(masks).toHaveLength(0);
    expect(skipped.map(({ reason }) => reason)).toEqual([
      'its segment did not restore',
      'its segment did not restore',
    ]);
  });

  // A parent image the restore never mapped is as lost as one whose data
  // failed to load, and its masks go the same way: 'we dropped two masks' has
  // to read differently from 'that image had none'.
  it('reports the masks of a parent image the restore never mapped', async () => {
    const { skipped, masks } = await restoreTampered(() => {}, undefined, {});

    expect(masks).toHaveLength(0);
    expect(skipped.map(({ reason }) => reason)).toEqual([
      'parent image data is unavailable',
      'parent image data is unavailable',
    ]);
    expect(skipped.every(({ name }) => name.length > 0)).toBe(true);
  });

  it('reports a second mask for a segment the image already has', async () => {
    const { skipped, masks } = await restoreTampered((parsed) => {
      const [first, second] = parsed.segmentations[0].masks;
      second.segmentId = first.segmentId;
    });

    expect(masks).toHaveLength(1);
    expect(skipped).toEqual([
      {
        name: expect.any(String),
        reason: 'the image already has a mask for its segment',
      },
    ]);
  });

  it('reports a mask its segmentation leaves out of the order', async () => {
    const { skipped, masks } = await restoreTampered((parsed) => {
      const [first] = parsed.segmentations[0].order;
      parsed.segmentations[0].order = [first];
    });

    expect(masks).toHaveLength(1);
    expect(skipped).toEqual([
      {
        name: expect.stringMatching(/.+/),
        reason: 'its segmentation does not list it',
      },
    ]);
  });

  it('names a dropped artifact mask by its artifact and label', async () => {
    const { skipped, masks } = await restoreArtifactMasks(['m1', 'm2']);

    expect(masks).toHaveLength(1);
    expect(skipped).toEqual([
      {
        name: 'labels.nii.gz label 3',
        reason: 'its segmentation does not list it',
      },
      {
        name: 'labels.nii.gz label 2',
        reason: 'its segment is not in the file',
      },
    ]);
  });
});
