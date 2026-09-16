import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

import {
  seatImage,
  seatSpecImage,
  inMemoryArtifactIO,
  bindEmptyMasks,
  seedVoxel,
  makeImage,
  manifestForImages,
  serializeToStateFiles,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { useSegmentStore } from '@/src/segmentation/segments';
import { ManifestSchema } from '@/src/io/state-file/schema';

// Every dropped mask must be named in the report surfaced by the caller.

const buildScene = async () => {
  await seatSpecImage('img-1', 'CT A');
  return bindEmptyMasks('img-1', ['Liver', 'Tumor']);
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
  await seatSpecImage('new-1', 'CT A');
  const result = await store().deserialize({
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
  const labels = await seatImage('labels', {
    dimensions: [4, 1, 1],
    values: new Uint8Array([1, 2, 3, 0]),
  });
  await seatImage('parent', { dimensions: [4, 1, 1] });
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
  const result = await store().deserialize({
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
    expect(skipped.map(({ name }) => name)).toEqual([
      'Segment Group 1 for CT A',
      'Segment Group 2 for CT A',
    ]);
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
    expect(skipped.map(({ name }) => name)).toEqual([
      'Segment Group 1 for CT A',
      'Segment Group 2 for CT A',
    ]);
  });

  it('reports a second mask for a segment the image already has', async () => {
    const { skipped, masks } = await restoreTampered((parsed) => {
      const [first, second] = parsed.segmentations[0].masks;
      second.segmentId = first.segmentId;
    });

    expect(masks).toHaveLength(1);
    expect(skipped).toEqual([
      {
        name: 'Segment Group 2 for CT A',
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
        name: 'Segment Group 2 for CT A',
        reason: 'its segmentation does not list it',
      },
    ]);
  });

  it.each([
    ['missing', 'archive member is missing'],
    ['multicomponent', 'multi-component masks are not supported'],
    ['unreadable', 'could not read/parse labelmap'],
  ])(
    'reports a saved mask whose entry is %s and preserves its neighbor',
    async (failure, reason) => {
      const [liver, tumor] = await buildScene();
      seedVoxel(liver, [1, 0, 0]);
      seedVoxel(tumor, [2, 0, 0]);
      const io = inMemoryArtifactIO();
      const { parsed, stateFiles } = await serializeToStateFiles(
        manifestForImages(['img-1']),
        io
      );
      const broken = parsed.segmentations[0].masks[0].representations.labelmap;
      const brokenFile = stateFiles.find(
        ({ archivePath }) => archivePath === broken.path
      )!.file;
      const damagedIO = {
        ...io,
        read: async (file: File) => {
          if (file !== brokenFile) return io.read(file);
          if (failure === 'unreadable') throw new Error('Unreadable mask');
          return { image: makeImage({ dimensions: [1, 1, 1], components: 2 }) };
        },
      };
      setActivePinia(createPinia());
      await seatSpecImage('new-1', 'CT A');
      const { skipped } = await store().deserialize({
        manifest: parsed,
        stateFiles:
          failure === 'missing'
            ? stateFiles.filter(({ file }) => file !== brokenFile)
            : stateFiles,
        dataIDMap: { 'img-1': 'new-1' },
        segmentIdMap: useSegmentStore().deserialize(parsed).segmentIdMap,
        io: damagedIO,
      });
      expect(skipped).toEqual([{ name: broken.name, reason }]);
      const savedIO = inMemoryArtifactIO();
      const { parsed: saved } = await serializeToStateFiles(
        manifestForImages(['new-1']),
        savedIO
      );
      const [unbound, survivor] = saved.segmentations[0].masks;
      expect(unbound.representations.labelmap).toBeUndefined();
      expect(survivor.representations.labelmap.extent).toEqual([
        2, 2, 0, 0, 0, 0,
      ]);
      expect(savedIO.snapshots).toEqual([
        { dimensions: [1, 1, 1], values: [1] },
      ]);
    }
  );

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
