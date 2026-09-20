import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

import { Chunk } from '@/src/core/streaming/chunk';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import { Tags } from '@/src/core/dicomTags';
import { useImageCacheStore } from '@/src/store/image-cache';
import {
  useSegmentationStore,
  type LabelmapIO,
} from '@/src/segmentation/store';
import { useToolStore } from '@/src/store/tools';
import { completeStateFileRestore } from '@/src/io/import/processors/restoreStateFile';
import { useMessageStore } from '@/src/store/messages';
import { useImageStatsStore } from '@/src/store/image-stats';
import { useDatasetStore } from '@/src/store/datasets';
import { useSegmentStore } from '@/src/segmentation/segments';
import { leafStateId } from '@/src/io/import/dataSource';
import { ManifestSchema } from '@/src/io/state-file/schema';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import {
  manifestForImages,
  seatImage,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { defer } from '@/src/utils';

const cache = () => useImageCacheStore();
const store = () => useSegmentationStore();
const artifact = (parentImage: string) => ({
  id: `artifact-${parentImage}`,
  name: `Mask ${parentImage}`,
  parentImage,
  path: `${parentImage}.vti`,
});

const setupRestore = async () => {
  const values = new Uint8Array(16);
  values[5] = 1;
  const image = await seatImage('artifact-data', {
    dimensions: [4, 4, 1],
    values,
  });
  await seatImage('healthy', { dimensions: [4, 4, 1] });
  const manifest = manifestForImages(['parent', 'healthy'], {
    primarySelection: 'healthy',
    segmentationArtifacts: [artifact('parent'), artifact('healthy')],
  });
  const stateFiles = ['parent', 'healthy'].map((id) => ({
    archivePath: `${id}.vti`,
    file: new File([id], `${id}.vti`),
  }));
  const io: LabelmapIO = {
    read: async () => ({ image }),
    write: async () => '',
  };
  const options = {
    manifest,
    stateFiles,
    dataIDMap: { parent: 'parent', healthy: 'healthy' },
    io,
  };
  return { image, options };
};

const expectPartialRestore = (
  result: Awaited<ReturnType<ReturnType<typeof store>['deserialize']>>,
  // Drops a scenario's own wire masks report, after the artifact's own.
  alsoSkipped: Array<{ name: string; reason: string }> = []
) => {
  expect(result.restoredImportIds).toEqual(new Set(['artifact-healthy']));
  expect(result.skipped).toHaveLength(1 + alsoSkipped.length);
  expect(result.skipped[0].name).toBe('Mask parent');
  expect(result.skipped.slice(1)).toEqual(alsoSkipped);
  expect(store().getSegmentationForImage('parent')).toBeUndefined();
  expect(store().imageMasks('healthy')).toHaveLength(1);
};

// Real chunk loading and terminal status transitions, with only pixel decoding
// held at the IO seam so deletion/completion can occur during the restore.
const pendingImage = async (id = 'parent') => {
  const decoded = defer<void>();
  const started = defer<void>();
  const meta = [
    [Tags.SOPInstanceUID, '1.2.3'],
    [Tags.ImagePositionPatient, '0\\0\\0'],
    [Tags.ImageOrientationPatient, '1\\0\\0\\0\\1\\0'],
    [Tags.Rows, '4'],
    [Tags.Columns, '4'],
    [Tags.PixelSpacing, '1\\1'],
    [Tags.BitsStored, '16'],
    [Tags.PixelRepresentation, '0'],
    [Tags.SamplesPerPixel, '1'],
  ] as Array<[string, string]>;
  const chunk = new Chunk({
    metaLoader: {
      meta,
      metaBlob: new Blob(['meta']),
      load: () => {},
      stop: () => {},
    },
    dataLoader: { data: new Blob(['pixels']), load: () => {}, stop: () => {} },
  });
  await chunk.loadMeta();
  await chunk.loadData();
  const image = new DicomChunkImage({
    splitAndSort: async (chunks) => ({ volume: chunks }),
    readDicomImage: async () => {
      started.resolve();
      await decoded.promise;
      return {
        image: {
          size: [4, 4, 1],
          data: Uint16Array.from({ length: 16 }, (_, index) =>
            index === 5 ? 1 : 0
          ),
          imageType: { components: 1 },
        },
      };
    },
  });
  await image.addChunks([chunk]);
  cache().addProgressiveImage(image, { id });
  await started.promise;
  expect(image.loading.value).toBe(true);
  return { image, decoded };
};

beforeEach(() => setActivePinia(createPinia()));

describe('artifact restore parent lifetime', () => {
  it('skips a parent removed during archive read and completes the other artifact', async () => {
    await seatImage('parent', { dimensions: [4, 4, 1] });
    const { image, options } = await setupRestore();
    const reading = defer<void>();
    const release = defer<void>();
    options.io.read = async () => {
      reading.resolve();
      await release.promise;
      return { image };
    };
    const restore = store().deserialize(options);
    await reading.promise;

    cache().removeImage('parent');
    release.resolve();

    expectPartialRestore(await restore);
  });

  it('settles when a parent is removed while its pixel loading is pending', async () => {
    const { options } = await setupRestore();
    const { decoded } = await pendingImage();
    const restore = store().deserialize(options);
    await nextTick();

    cache().removeImage('parent');
    decoded.resolve();

    expectPartialRestore(await restore);
  });

  it('waits for a slow progressive parent that ultimately loads', async () => {
    const { options } = await setupRestore();
    const { image, decoded } = await pendingImage();
    let settled = false;
    const restore = store()
      .deserialize(options)
      .then((value) => {
        settled = true;
        return value;
      });
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    expect(image.status.value).toBe('incomplete');

    decoded.resolve();
    const result = await restore;

    expect(result.skipped).toEqual([]);
    expect(result.restoredImportIds).toEqual(
      new Set(['artifact-parent', 'artifact-healthy'])
    );
    expect(store().imageMasks('parent')).toHaveLength(1);
  });

  it('skips a terminal failed DICOM parent and permits downstream tool restore', async () => {
    const { options } = await setupRestore();
    const { image, decoded } = await pendingImage();
    const originalDeserialize = store().deserialize;
    const injectIO = vi
      .spyOn(store(), 'deserialize')
      .mockImplementation((args) =>
        originalDeserialize({ ...args, io: options.io })
      );
    const tools = vi.spyOn(useToolStore(), 'deserialize');
    const restore = completeStateFileRestore(
      options.manifest,
      options.stateFiles,
      options.dataIDMap
    );
    await nextTick();

    decoded.reject(new Error('Pixel read failed'));
    await restore;

    expect(image.loading.value).toBe(false);
    expect(image.status.value).toBe('incomplete');
    expect(store().imageMasks('healthy')).toHaveLength(1);
    expect(tools).toHaveBeenCalledOnce();
    expect(
      useMessageStore().messages.find(
        (message) =>
          message.title === 'Some scene content could not be restored'
      )?.options.details
    ).toContain('Mask parent');
    injectIO.mockRestore();
    tools.mockRestore();
  });

  it('does not recreate a parent removed after its artifact loaded', async () => {
    await seatImage('parent', { dimensions: [4, 4, 1] });
    const { image, options } = await setupRestore();
    // The saved mask is read after artifacts; its IO boundary makes the gap
    // between artifact placement and attachment observable.
    const segmentId = 'saved-type';
    const manifest = options.manifest;
    manifest.segmentations = [
      {
        id: 'wire',
        parentImage: 'healthy',
        name: '',
        fillOpacity: 1,
        outlineOpacity: 1,
        outlineThickness: 1,
        order: ['saved-mask'],
        masks: [
          {
            id: 'saved-mask',
            segmentId,
            representations: {
              labelmap: {
                path: 'saved.vti',
                extent: [0, 3, 0, 3, 0, 0],
              },
            },
          },
        ],
      },
    ];
    options.stateFiles.push({
      archivePath: 'saved.vti',
      file: new File(['saved'], 'saved.vti'),
    });
    options.io.read = async (file?: File) => {
      if (file?.name === 'saved.vti') cache().removeImage('parent');
      return { image };
    };

    const result = await store().deserialize(options);

    // The saved mask names a segment this restore was given no mapping for,
    // so it is dropped, and the drop is reported rather than silent.
    expectPartialRestore(result, [
      { name: '', reason: 'its segment is not in the file' },
    ]);
  });
});

async function pendingSourceRestore(temporary: boolean) {
  for (const id of ['source', 'healthy']) {
    useImageStatsStore().stats[id] = {
      scalarMin: 0,
      scalarMax: 1,
      autoRangeValues: {},
    };
  }
  const { options } = await setupRestore();
  const { image, decoded } = await pendingImage('source');
  const manifest = manifestForImages(['healthy'], {
    dataSources: [
      { id: 1, type: 'uri', uri: '/healthy.nrrd' },
      { id: 2, type: 'uri', uri: '/mask.dcm' },
    ],
    datasets: [
      { id: 'healthy', dataSourceId: 1 },
      ...(!temporary ? [{ id: 'source', dataSourceId: 2 }] : []),
    ],
    segmentationArtifacts: [
      ...['first', 'second'].map((id) => ({
        id,
        name: id,
        parentImage: 'healthy',
        dataSourceId: 2,
      })),
      artifact('healthy'),
    ],
  });
  const deserialize = store().deserialize;
  const injectedIO = vi
    .spyOn(store(), 'deserialize')
    .mockImplementation((args) => deserialize({ ...args, io: options.io }));
  const tools = vi.spyOn(useToolStore(), 'deserialize');
  const remove = vi.spyOn(useDatasetStore(), 'remove');
  let completed = false;
  const restore = completeStateFileRestore(manifest, options.stateFiles, {
    healthy: 'healthy',
    [temporary ? leafStateId(2) : 'source']: 'source',
  }).then(() => {
    completed = true;
  });
  return {
    image,
    decoded,
    restore,
    tools,
    remove,
    injectedIO,
    completed: () => completed,
  };
}

describe.each([true, false])(
  'artifact source lifetime, temporary: %s',
  (temporary) => {
    it.each(['failure', 'removal'])(
      'settles on source %s and restores healthy downstream content',
      async (action) => {
        const pending = await pendingSourceRestore(temporary);
        await nextTick();
        expect(pending.completed()).toBe(false);
        expect(pending.image.loading.value).toBe(true);
        if (action === 'failure')
          pending.decoded.reject(new Error('Source pixel read failed'));
        else {
          cache().removeImage('source');
          pending.decoded.resolve();
        }
        await pending.restore;

        expect(store().imageMasks('healthy')).toHaveLength(1);
        expect(pending.tools).toHaveBeenCalledOnce();
        expect(pending.remove.mock.calls).toEqual(
          temporary ? [['source']] : []
        );
        expect(!!cache().imageById.source).toBe(
          !temporary && action === 'failure'
        );
        const details = useMessageStore().messages.find(
          (message) =>
            message.title === 'Some scene content could not be restored'
        )?.options.details;
        expect(details).toContain('first');
        expect(details).toContain('second');
        pending.injectedIO.mockRestore();
        pending.tools.mockRestore();
        pending.remove.mockRestore();
      }
    );

    it('waits for a slow shared source, attaches both masks, and cleans up only owned data', async () => {
      const pending = await pendingSourceRestore(temporary);
      await nextTick();
      expect(pending.completed()).toBe(false);
      expect(pending.remove).not.toHaveBeenCalled();
      pending.decoded.resolve();
      await pending.restore;

      expect(store().imageMasks('healthy')).toHaveLength(3);
      expect(pending.tools).toHaveBeenCalledOnce();
      expect(pending.remove.mock.calls).toEqual(temporary ? [['source']] : []);
      expect(!!cache().imageById.source).toBe(!temporary);
      expect(
        useMessageStore().messages.some(
          (message) =>
            message.title === 'Some scene content could not be restored'
        )
      ).toBe(false);
      pending.injectedIO.mockRestore();
      pending.tools.mockRestore();
      pending.remove.mockRestore();
    });
  }
);

describe('a multi-component artifact', () => {
  /** A vector volume: two interleaved scalars per voxel, on a 4x1x1 grid. */
  const seatVectorSource = async () => {
    await seatImage('parent', { dimensions: [4, 1, 1] });
    const image = await seatImage('source', { dimensions: [4, 1, 1] });
    image.getPointData().setScalars(
      vtkDataArray.newInstance({
        numberOfComponents: 2,
        values: new Uint8Array([0, 0, 1, 0, 0, 2, 0, 0]),
      })
    );
    return image;
  };

  const restoreVectorArtifact = async (
    input: Record<string, unknown>,
    labelmapSources?: Record<string, { stateId: string; temporary: boolean }>
  ) => {
    const image = await seatVectorSource();
    return store().deserialize({
      manifest: manifestForImages(['parent', 'source'], {
        segmentationArtifacts: [
          {
            id: 'vector',
            parentImage: 'parent',
            name: 'vector.nrrd',
            ...input,
          },
        ],
      }),
      stateFiles: [
        { archivePath: 'vector.vti', file: new File([''], 'vector.vti') },
      ],
      dataIDMap: { parent: 'parent', source: 'source' },
      labelmapSources,
      io: { write: async () => '', read: async () => ({ image }) },
    });
  };

  const expectRejected = (
    result: Awaited<ReturnType<ReturnType<typeof store>['deserialize']>>
  ) => {
    expect(result.skipped).toEqual([
      {
        name: 'vector.nrrd',
        reason: 'multi-component labelmap artifacts are not supported',
      },
    ]);
    expect(result.restoredImportIds).toEqual(new Set());
    expect(store().imageMasks('parent')).toEqual([]);
  };

  it('is skipped when it comes from an archive entry', async () => {
    expectRejected(await restoreVectorArtifact({ path: 'vector.vti' }));
  });

  it('is skipped when it comes from a data source', async () => {
    expectRejected(
      await restoreVectorArtifact(
        { dataSourceId: 2 },
        {
          vector: { stateId: 'source', temporary: false },
        }
      )
    );
  });
});

// A manifest's mask ids are its own, and a hand-authored or server-produced
// one may spell an Object.prototype key.
describe('an artifact-backed mask whose id spells a prototype member', () => {
  const restoreArtifactMask = async (maskId: string) => {
    await seatImage('parent', { dimensions: [4, 1, 1] });
    const image = await seatImage('source', {
      dimensions: [4, 1, 1],
      values: new Uint8Array([0, 1, 1, 0]),
    });
    const manifest = ManifestSchema.parse(
      manifestForImages(['parent'], {
        segments: [{ id: 'tumor', name: 'Tumor', color: [255, 0, 0, 255] }],
        segmentations: [
          {
            id: 'segmentation',
            name: 'CT',
            parentImage: 'parent',
            order: [maskId],
            masks: [
              {
                id: maskId,
                segmentId: 'tumor',
                representations: {
                  labelmap: {
                    artifactId: 'tumor-labelmap',
                    sourceValue: 1,
                    extent: [0, -1, 0, -1, 0, -1],
                  },
                },
              },
            ],
          },
        ],
        segmentationArtifacts: [
          {
            id: 'tumor-labelmap',
            parentImage: 'parent',
            name: 'Tumor.vti',
            path: 'mask.vti',
          },
        ],
      })
    );
    const result = await store().deserialize({
      manifest,
      stateFiles: [
        { archivePath: 'mask.vti', file: new File([''], 'mask.vti') },
      ],
      dataIDMap: { parent: 'parent' },
      segmentIdMap: useSegmentStore().deserialize(manifest),
      io: { write: async () => '', read: async () => ({ image }) },
    });
    return { result, mask: store().imageMasks('parent')[0] };
  };

  it.each(['ordinary-mask', '__proto__'])(
    'takes the artifact voxels the id %s claims',
    async (maskId) => {
      const { result, mask } = await restoreArtifactMask(maskId);

      expect(result.skipped).toEqual([]);
      expect([...mask.representations.labelmap!.extent]).toEqual([
        1, 2, 0, 0, 0, 0,
      ]);
      expect([...store().maskVoxels(mask.id).scalars()]).toEqual([
        SEGMENT_VALUE,
        SEGMENT_VALUE,
      ]);
    }
  );
});
