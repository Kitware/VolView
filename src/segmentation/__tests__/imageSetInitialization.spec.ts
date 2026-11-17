import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { showImportedData } from '@/src/actions/loadUserFiles';
import { asLoadableResult } from '@/src/io/import/common';
import { importDataSources } from '@/src/io/import/importDataSources';
import { completeStateFileRestore } from '@/src/io/import/processors/restoreStateFile';
import { migrateManifest } from '@/src/io/state-file/migrations';
import { ManifestSchema } from '@/src/io/state-file/schema';
import {
  inMemoryArtifactIO,
  makeLabelmap,
  manifestForImages,
  savedLabelmaps,
  savedSegmentNames,
  seatImage,
  serializeAnnotations,
  serializeToStateFiles,
  segmentNames,
  showImage,
  viewImage,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useSegmentationStore } from '@/src/segmentation/store';
import { deserializeSegmentation } from '@/src/segmentation/io/stateFile';
import { planLabelmapSources } from '@/src/io/import/labelmapImports';
import { useViewStore } from '@/src/store/views';
import { useImageStatsStore } from '@/src/store/image-stats';
import { defer } from '@/src/utils';
import { Skip } from '@/src/utils/evaluateChain';
import { useLabelmapImportStore } from '@/src/segmentation/io/labelmapImport';

describe('image segment initialization boundaries', () => {
  beforeEach(() => setActivePinia(createPinia()));
  afterEach(() => vi.restoreAllMocks());

  it('gives an image without a saved set the current config', async () => {
    useSegmentStore().segments.applyConfig({ Site: { color: 'red' } });
    await seatImage('destination');

    await completeStateFileRestore(
      manifestForImages(['incoming'], { primarySelection: 'incoming' }),
      [],
      { incoming: 'destination' }
    );

    expect(segmentNames('destination')).toEqual(['Site']);
  });

  it('starts an image without a saved set empty without a config', async () => {
    await viewImage('existing');
    const store = useSegmentStore();
    store.segments.addSegment('existing', { name: 'Liver' });
    await seatImage('destination');

    await completeStateFileRestore(
      manifestForImages(['incoming'], { primarySelection: 'incoming' }),
      [],
      { incoming: 'destination' }
    );

    expect(segmentNames('destination')).toEqual([]);
  });

  it.each([false, true])(
    'seeds an image edited before it is viewed like a viewed one, configured: %s',
    async (configured) => {
      if (configured) useSegmentStore().segments.applyConfig({ Site: {} });
      await viewImage('existing');
      useSegmentStore().segments.addSegment('existing', { name: 'Liver' });
      await seatImage('destination');

      useSegmentStore().segments.addSegment('destination', { name: 'Tumor' });

      expect(segmentNames('destination')).toEqual(
        configured ? ['Site', 'Tumor'] : ['Tumor']
      );
      expect(segmentNames('existing')).toEqual(
        configured ? ['Site', 'Liver'] : ['Liver']
      );
    }
  );

  it.each([true, false])(
    'distinguishes a saved empty set from its missing-entry negative control (saved: %s)',
    async (savedEmptySet) => {
      useSegmentStore().segments.applyConfig({ Fallback: {} });
      await viewImage('existing');
      useSegmentStore().segments.mintSegment('existing', { name: 'Existing' });
      await seatImage('destination');
      const manifest = manifestForImages(['incoming'], {
        primarySelection: 'incoming',
        imageSegments: savedEmptySet
          ? [{ imageId: 'incoming', segments: [] }]
          : [],
      });
      await completeStateFileRestore(manifest, [], { incoming: 'destination' });

      expect(segmentNames('destination')).toEqual(
        savedEmptySet ? [] : ['Fallback']
      );
      expect(segmentNames('existing')).toEqual(['Fallback', 'Existing']);
      if (savedEmptySet)
        expect(serializeAnnotations().imageSegments).toContainEqual({
          imageId: 'destination',
          segments: [],
        });
    }
  );

  it('applies an accompanying config to every loaded image', async () => {
    await viewImage('existing');
    useSegmentStore().segments.mintSegment('existing', { name: 'Existing' });
    await seatImage('new-image');
    const imageFile = new File([], 'new-image.nrrd');
    const configFile = new File(
      [
        JSON.stringify({
          segments: { Configured: { color: '#00ff00' } },
        }),
      ],
      'config.json',
      { type: 'application/json' }
    );
    await importDataSources(
      [
        { type: 'file', file: imageFile, fileType: 'application/octet-stream' },
        { type: 'file', file: configFile, fileType: 'application/json' },
      ],
      {
        restoreStateFile: async (source) =>
          source.type === 'file' && source.file.name === imageFile.name
            ? asLoadableResult('new-image', source, 'image')
            : Skip,
        completeStateFileRestore: async () => {},
      }
    );

    await showImage('new-image');
    expect(segmentNames('new-image')).toEqual(['Configured']);
    expect(segmentNames('existing')).toEqual(['Existing', 'Configured']);
  });

  const companionImport = async (edit: () => void = () => {}) => {
    await seatImage('base');
    await seatImage('labelmap', { values: new Uint8Array(64).fill(1) });
    const store = useLabelmapImportStore();
    const convert = store.startLabelmapConversion;
    const entered = defer<void>();
    const released = defer<void>();
    let conversion: Promise<unknown> = Promise.resolve();
    vi.spyOn(store, 'startLabelmapConversion').mockImplementation(
      (imageId, parentId, options) => {
        conversion = convert(imageId, parentId, {
          ...options,
          resample: async (_parent, image) => {
            entered.resolve();
            await released.promise;
            return image;
          },
        });
        return conversion as ReturnType<typeof convert>;
      }
    );
    showImportedData([
      asLoadableResult(
        'base',
        { type: 'uri', uri: '/base.nrrd', name: 'base.nrrd' },
        'image'
      ),
      asLoadableResult(
        'labelmap',
        { type: 'uri', uri: '/base.seg.nrrd', name: 'base.seg.nrrd' },
        'image'
      ),
    ]);
    await entered.promise;
    const pendingNames = segmentNames('base');
    edit();
    released.resolve();
    await conversion;
    return pendingNames;
  };

  it('merges a companion segmentation into the configured defaults', async () => {
    useSegmentStore().segments.applyConfig({ Lung: {}, Lesion: {} });
    await viewImage('existing');
    useSegmentStore().segments.mintSegment('existing', { name: 'Unrelated' });

    const pendingNames = await companionImport();

    expect(pendingNames).toEqual(['Lung', 'Lesion']);
    expect(segmentNames('base')).toEqual(['Lung', 'Lesion', 'labelmap']);
    expect(segmentNames('existing')).toEqual(['Lung', 'Lesion', 'Unrelated']);
  });

  it.each([false, true])(
    'keeps edits made while a companion segmentation decodes: %s',
    async (edited) => {
      const store = useSegmentStore();
      store.segments.applyConfig({ Lung: {} });
      await viewImage('existing');
      store.segments.addSegment('existing', { name: 'Unrelated' });

      await companionImport(() => {
        if (edited) store.segments.addSegment('base', { name: 'My edit' });
        store.segments.applyConfig({ Other: {} });
      });

      expect(segmentNames('base')).toEqual(
        edited
          ? ['Lung', 'My edit', 'Other', 'labelmap']
          : ['Lung', 'Other', 'labelmap']
      );
    }
  );

  it.each([
    { version: '7.0.0' },
    { version: '8.0.0' },
    { version: '8.0.0', imageSegments: [] },
  ])(
    'initializes artifact-only images from configured defaults: %j',
    async (wire) => {
      const store = useSegmentStore();
      store.segments.applyConfig({ Site: {} });
      await viewImage('existing');
      store.segments.addSegment('existing', { name: 'Unrelated' });
      await seatImage('destination-a');
      await seatImage('destination-b');
      const image = await seatImage('artifact', {
        values: new Uint8Array(64).fill(1),
      });
      const ids = ['a', 'b'];
      const migrated = migrateManifest(
        JSON.stringify(
          manifestForImages(ids, {
            ...wire,
            primarySelection: 'a',
            segmentationArtifacts: ids.map((id) => ({
              id: `artifact-${id}`,
              name: `Mask ${id}`,
              parentImage: id,
              path: `${id}.vti`,
            })),
          })
        )
      );
      // The restore's own steps, so the labelmap codec can be injected.
      const manifest = ManifestSchema.parse(migrated.manifest);
      const dataIDMap = { a: 'destination-a', b: 'destination-b' };
      const resolveSegment = store.deserialize(manifest, dataIDMap);
      useViewStore().setDataForAllViews('destination-a');
      await deserializeSegmentation({
        manifest,
        stateFiles: ids.map((id) => ({
          archivePath: `${id}.vti`,
          file: new File([], `${id}.vti`),
        })),
        dataIDMap,
        resolveSegment,
        labelmapSources: planLabelmapSources(manifest).sources,
        io: { read: async () => ({ image }), write: async () => '' },
      });

      ids.forEach((id) => {
        expect(savedSegmentNames(`destination-${id}`)).toEqual([
          'Site',
          `Mask ${id}`,
        ]);
        expect(
          useSegmentationStore().imageMasks(`destination-${id}`)
        ).toHaveLength(1);
      });
      await showImage('destination-b');
      expect(savedSegmentNames('destination-b')).toEqual(['Site', 'Mask b']);
      expect(savedSegmentNames('existing')).toEqual(['Site', 'Unrelated']);
    }
  );

  it.each([false, true])(
    'binds a mixed manifest artifact by its own name, with destination viewed: %s',
    async (viewed) => {
      await viewImage('existing');
      const segments = useSegmentStore();
      segments.segments.addSegment('existing', { name: 'Tumor' });
      segments.segments.addSegment('existing', { name: 'Unused' });
      await seatImage('destination');
      await seatImage('other');
      if (viewed) await showImage('destination');
      const manifest = manifestForImages(['target', 'other'], {
        imageSegments: [{ imageId: 'other', segments: [] }],
        segmentationArtifacts: [
          {
            id: 'artifact',
            name: 'Tumor.vti',
            path: 'Tumor.vti',
            parentImage: 'target',
          },
        ],
      });
      const dataIDMap = { target: 'destination', other: 'other' };
      const resolveSegment = segments.deserialize(manifest, dataIDMap);
      const io = inMemoryArtifactIO();
      const encoded = await io.write(
        'vti',
        makeLabelmap({ values: new Uint8Array(64).fill(1) })
      );

      await deserializeSegmentation({
        manifest,
        dataIDMap,
        resolveSegment,
        stateFiles: [
          { archivePath: 'Tumor.vti', file: new File([encoded], 'Tumor.vti') },
        ],
        io,
      });

      expect(savedSegmentNames('destination')).toEqual(['Tumor']);
      expect(savedSegmentNames('other')).toEqual([]);
      const { parsed: saved } = await serializeToStateFiles(
        manifestForImages(['destination']),
        io
      );
      const [tumor] = saved.imageSegments.find(
        ({ imageId }: { imageId: string }) => imageId === 'destination'
      ).segments;
      expect(savedLabelmaps(saved)).toEqual([
        expect.objectContaining({
          imageId: 'destination',
          segmentId: tumor.id,
        }),
      ]);
    }
  );

  it.each([
    { savedLayout: false, savedViews: true, slotCount: 2 },
    { savedLayout: true, savedViews: true, slotCount: 2 },
    { savedLayout: true, savedViews: false, slotCount: 2 },
    { savedLayout: true, savedViews: false, slotCount: 1 },
    { savedLayout: true, savedViews: false, slotCount: 2, activeSlot: 0 },
    { savedLayout: true, savedViews: false, slotCount: 2, activeSlot: 1 },
  ])(
    'ignores old view contents while replacing a restored layout: %j',
    async ({ savedLayout, savedViews, slotCount, activeSlot }) => {
      ['existing', 'other', 'destination'].forEach((id) => {
        useImageStatsStore().stats[id] = {
          scalarMin: 0,
          scalarMax: 0,
          autoRangeValues: {},
        };
      });
      await viewImage('existing');
      const store = useSegmentStore();
      store.segments.addSegment('existing', { name: 'Previous' });
      await seatImage('other');
      store.segments.addSegment('other', { name: 'Wrong source' });
      await seatImage('destination');
      const views = useViewStore();
      const previousViewId = views.viewIDs[1];
      views.setDataForView(previousViewId, 'existing');
      views.setActiveView(previousViewId);
      const incomingViewId = views.viewIDs[0];
      views.setDataForView(incomingViewId, 'other');
      const activeView = activeSlot === 1 ? previousViewId : incomingViewId;
      const manifest = manifestForImages(['saved'], {
        ...(savedViews || activeSlot !== undefined ? { activeView } : {}),
        ...(savedLayout
          ? {
              layout: {
                direction: 'row',
                items: Array.from({ length: slotCount }, (_, slotIndex) => ({
                  type: 'slot',
                  slotIndex,
                })),
              },
            }
          : {}),
        layoutSlots: [incomingViewId, previousViewId],
        isActiveViewMaximized: true,
        ...(savedViews
          ? {
              viewByID: {
                [incomingViewId]: {
                  ...views.viewByID[incomingViewId],
                  dataID: 'saved',
                },
                [previousViewId]: {
                  ...views.viewByID[previousViewId],
                  dataID: null,
                },
              },
            }
          : {}),
      });

      views.deserializeLayout(manifest);
      await completeStateFileRestore(manifest, [], { saved: 'destination' });

      expect(savedSegmentNames('destination')).toEqual([]);
      expect(views.visibleViews.map(({ dataID }) => dataID)).toEqual([
        'destination',
      ]);
      if (activeSlot !== undefined)
        expect(views.visibleViews.map(({ id }) => id)).toEqual([activeView]);
    }
  );

  it('merges a restored set into an image that already has one', async () => {
    await viewImage('existing');
    useSegmentStore().segments.mintSegment('existing', { name: 'Liver' });
    await viewImage('destination');
    useSegmentStore().segments.mintSegment('destination', { name: 'Liver' });

    await completeStateFileRestore(
      manifestForImages(['incoming'], {
        primarySelection: 'incoming',
        imageSegments: [
          {
            imageId: 'incoming',
            segments: [
              {
                id: 's1',
                name: 'Tumor',
                color: [1, 2, 3, 255],
                visible: true,
                locked: false,
              },
            ],
          },
        ],
      }),
      [],
      { incoming: 'destination' }
    );

    expect(segmentNames('destination')).toEqual(['Liver', 'Tumor']);
    expect(segmentNames('existing')).toEqual(['Liver']);
  });
});
