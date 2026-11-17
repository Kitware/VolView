import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

import {
  seatSpecImage,
  inMemoryArtifactIO,
  addSegment,
  bindMasks,
  seedVoxel,
  makeImage,
  manifestForImages,
  serializeToStateFiles,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { deserializeSegmentation } from '@/src/segmentation/io/stateFile';
import {
  useSegmentStore,
  type SegmentResolver,
} from '@/src/segmentation/segments';
import { ManifestSchema } from '@/src/io/state-file/schema';
import { migrateManifest } from '@/src/io/state-file/migrations';
import { createStateFileRestorer } from '@/src/io/import/processors/restoreStateFile';

// Every dropped mask must be named in the report surfaced by the caller.

const buildScene = async () => {
  await seatSpecImage('img-1', 'CT A');
  return bindMasks('img-1', ['Liver', 'Tumor']);
};

const restoreTampered = async (
  tamper: (parsed: any) => void,
  resolverFor: (parsed: any) => SegmentResolver = (parsed) =>
    useSegmentStore().deserialize(parsed, { 'img-1': 'new-1' }),
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
  const result = await deserializeSegmentation({
    manifest: parsed,
    stateFiles,
    dataIDMap,
    resolveSegment: resolverFor(parsed),
    io,
  });
  return {
    skipped: result.skipped,
    masks: store()
      .imageMasks('new-1')
      .map(({ segmentId }) => segmentId),
  };
};

describe('masks dropped during restore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('reports a mask whose segment did not restore', async () => {
    const { skipped, masks } = await restoreTampered(
      () => {},
      () => () => 'no-such-segment'
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
    expect(skipped.map(({ name }) => name)).toEqual(['Liver', 'Tumor']);
  });

  it('reports a second mask for a segment the image already has', async () => {
    const { skipped, masks } = await restoreTampered((parsed) => {
      const [first, second] = parsed.imageSegments[0].segments;
      second.id = first.id;
    });

    expect(masks).toHaveLength(1);
    expect(skipped).toEqual([
      {
        name: 'Tumor',
        reason: 'the image already has a mask for its segment',
      },
    ]);
  });

  // 8.0.0 has no order, so a 7.0.0 file's unlisted masks are dropped by the
  // migration and reported with the restore.
  it('reports a mask a 7.0.0 segmentation leaves out of its order', async () => {
    await seatSpecImage('new-1', 'CT A');
    const { manifest, migration } = migrateManifest(
      JSON.stringify({
        ...manifestForImages(['img-1']),
        version: '7.0.0',
        segments: [{ id: 'tumor', name: 'Tumor', color: [255, 0, 0, 255] }],
        segmentations: [
          {
            id: 'wire',
            name: 'CT A',
            parentImage: 'img-1',
            order: [],
            masks: [
              {
                id: 'unlisted',
                segmentId: 'tumor',
                representations: {
                  labelmap: {
                    path: 'unlisted.vti',
                    extent: [0, 0, 0, 0, 0, 0],
                  },
                },
              },
            ],
          },
        ],
      })
    );
    const warnings: string[] = [];
    await createStateFileRestorer({
      addWarning: (title, options) => {
        warnings.push(
          typeof options === 'string' ? options : (options?.details ?? '')
        );
        return title;
      },
    })(ManifestSchema.parse(manifest), [], { 'img-1': 'new-1' }, { migration });

    expect(store().imageMasks('new-1')).toEqual([]);
    expect(warnings).toEqual([
      '- labelmap: Tumor (its segmentation does not list it)',
    ]);
  });

  it.each([
    ['missing', 'archive member is missing'],
    ['multicomponent', 'multi-component masks are not supported'],
    ['unreadable', 'could not read/parse labelmap'],
  ])(
    'reports a saved mask whose entry is %s and preserves its neighbor',
    async (failure, reason) => {
      await seatSpecImage('img-1', 'CT A');
      const liver = addSegment('img-1', 'Liver');
      const tumor = addSegment('img-1', 'Tumor');
      seedVoxel(liver, [1, 0, 0]);
      seedVoxel(tumor, [2, 0, 0]);
      const io = inMemoryArtifactIO();
      const { parsed, stateFiles } = await serializeToStateFiles(
        manifestForImages(['img-1']),
        io
      );
      const broken = parsed.imageSegments[0].segments[0].labelmap;
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
      const { skipped } = await deserializeSegmentation({
        manifest: parsed,
        stateFiles:
          failure === 'missing'
            ? stateFiles.filter(({ file }) => file !== brokenFile)
            : stateFiles,
        dataIDMap: { 'img-1': 'new-1' },
        resolveSegment: useSegmentStore().deserialize(parsed, {
          'img-1': 'new-1',
        }),
        io: damagedIO,
      });
      expect(skipped).toEqual([{ name: 'Liver', reason }]);
      const savedIO = inMemoryArtifactIO();
      const { parsed: saved } = await serializeToStateFiles(
        manifestForImages(['new-1']),
        savedIO
      );
      const [survivor, ...rest] = saved.imageSegments[0].segments.filter(
        ({ labelmap }: any) => labelmap
      );
      expect(rest).toEqual([]);
      expect(survivor.id).toBe(store().imageMasks('new-1')[0].segmentId);
      expect(survivor.labelmap.extent).toEqual([2, 2, 0, 0, 0, 0]);
      expect(savedIO.snapshots).toEqual([
        { dimensions: [1, 1, 1], values: [1] },
      ]);
    }
  );
});
