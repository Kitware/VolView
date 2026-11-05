import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { showImportedData } from '@/src/actions/loadUserFiles';
import { asLoadableResult } from '@/src/io/import/common';
import { importDataSources } from '@/src/io/import/importDataSources';
import { completeStateFileRestore } from '@/src/io/import/processors/restoreStateFile';
import { migrateManifest } from '@/src/io/state-file/migrations';
import { ManifestSchema } from '@/src/io/state-file/schema';
import {
  manifestForImages,
  seatImage,
  serializeAnnotations,
  segmentNames,
  showImage,
  viewImage,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useViewStore } from '@/src/store/views';
import { useImageStatsStore } from '@/src/store/image-stats';
import { defer } from '@/src/utils';
import { Skip } from '@/src/utils/evaluateChain';

const savedSegmentNames = (imageId: string) => {
  const manifest = serializeAnnotations();
  const set = manifest.imageSegmentSets?.find(
    (entry) => entry.imageId === imageId
  );
  return (set?.segmentIds ?? []).map(
    (id) => manifest.segments?.find((segment) => segment.id === id)?.name
  );
};

describe('image segment initialization boundaries', () => {
  beforeEach(() => setActivePinia(createPinia()));
  afterEach(() => vi.restoreAllMocks());

  it('copies order and selection when an empty view is activated before assigning data', async () => {
    await viewImage('a');
    const store = useSegmentStore();
    const selected = store.segments.addSegment('a', { name: 'Selected' });
    const first = store.segments.addSegment('a', { name: 'First' });
    store.segments.moveSegment(first, selected);
    store.segments.selectSegment(selected);
    await seatImage('b');
    const views = useViewStore();
    const emptyView = views.viewIDs.find((id) => id !== views.activeView)!;
    views.setDataForView(emptyView, null);

    views.setActiveView(emptyView);
    views.setDataForView(emptyView, 'b');

    expect(segmentNames('b')).toEqual(['First', 'Selected']);
    const copied = store.segments.findSegmentByName('b', 'Selected')!;
    expect(store.segments.selectedSegmentId('b')).toBe(copied.id);
    expect(copied.id).not.toBe(selected);
  });

  it.each([[], [{ name: 'Session', color: [1, 2, 3, 255] }]])(
    'uses restored defaults for an image without a saved set',
    async (...defaults) => {
      const store = useSegmentStore();
      store.replaceConfigSegments({ Site: { color: 'red' } }, []);
      await seatImage('destination');
      const manifest = manifestForImages(['incoming'], {
        primarySelection: 'incoming',
        seedSegmentDefaults: defaults,
      });

      await completeStateFileRestore(manifest, [], { incoming: 'destination' });

      expect(segmentNames('destination')).toEqual(
        defaults.map(({ name }) => name)
      );
      expect(serializeAnnotations().seedSegmentDefaults).toEqual(defaults);
    }
  );

  it('keeps the previous image copy when a session carries neither sets nor defaults', async () => {
    await viewImage('existing');
    const store = useSegmentStore();
    store.segments.addSegment('existing', { name: 'Liver' });
    await seatImage('destination');

    await completeStateFileRestore(
      manifestForImages(['incoming'], { primarySelection: 'incoming' }),
      [],
      { incoming: 'destination' }
    );

    expect(segmentNames('destination')).toEqual(['Liver']);
  });

  it('seeds an image edited before it is viewed like a viewed one', async () => {
    await viewImage('existing');
    useSegmentStore().segments.addSegment('existing', { name: 'Liver' });
    await seatImage('destination');

    useSegmentStore().segments.addSegment('destination', { name: 'Tumor' });

    expect(segmentNames('destination')).toEqual(['Liver', 'Tumor']);
    expect(segmentNames('existing')).toEqual(['Liver']);
  });

  it.each([true, false])(
    'distinguishes a saved empty set from its missing-entry negative control (saved: %s)',
    async (savedEmptySet) => {
      await viewImage('existing');
      useSegmentStore().segments.mintSegment('existing', { name: 'Existing' });
      await seatImage('destination');
      const manifest = manifestForImages(['incoming'], {
        primarySelection: 'incoming',
        segments: [],
        seedSegmentDefaults: [{ name: 'Fallback' }],
        imageSegmentSets: savedEmptySet
          ? [{ imageId: 'incoming', segmentIds: [] }]
          : [],
      });
      await completeStateFileRestore(manifest, [], { incoming: 'destination' });

      expect(segmentNames('destination')).toEqual(
        savedEmptySet ? [] : ['Fallback']
      );
      expect(segmentNames('existing')).toEqual(['Existing']);
      if (savedEmptySet)
        expect(serializeAnnotations().imageSegmentSets).toContainEqual({
          imageId: 'destination',
          segmentIds: [],
        });
    }
  );

  it('applies an accompanying config to loaded images while leaving the active image alone', async () => {
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
    expect(segmentNames('existing')).toEqual(['Existing']);
    expect(
      serializeAnnotations().seedSegmentDefaults?.map(({ name }) => name)
    ).toEqual(['Configured']);
  });

  const companionImport = async (edit: () => void = () => {}) => {
    await seatImage('base');
    await seatImage('labelmap', { values: new Uint8Array(64).fill(1) });
    const store = useSegmentationStore();
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

  it('replaces an untouched copy with a companion segmentation', async () => {
    await viewImage('existing');
    useSegmentStore().segments.mintSegment('existing', { name: 'Unrelated' });

    const pendingNames = await companionImport();

    expect(pendingNames).toEqual(['Unrelated']);
    expect(segmentNames('base')).toHaveLength(1);
    expect(segmentNames('base')).not.toContain('Unrelated');
    expect(useSegmentationStore().imageMasks('base')).toHaveLength(1);
    expect(segmentNames('existing')).toEqual(['Unrelated']);
  });

  it('merges a companion segmentation into the configured defaults', async () => {
    useSegmentStore().replaceConfigSegments({ Lung: {}, Lesion: {} }, []);
    await viewImage('existing');
    useSegmentStore().segments.mintSegment('existing', { name: 'Unrelated' });

    const pendingNames = await companionImport();

    expect(pendingNames).toEqual(['Lung', 'Lesion', 'Unrelated']);
    expect(segmentNames('base')).toEqual(['Lung', 'Lesion', 'labelmap']);
    expect(segmentNames('existing')).toEqual(['Lung', 'Lesion', 'Unrelated']);
  });

  it.each([false, true])(
    "captures a companion conversion's defaults while preserving intervening edits: %s",
    async (edited) => {
      const store = useSegmentStore();
      store.replaceConfigSegments({ Lung: {} }, []);
      await viewImage('existing');
      store.segments.addSegment('existing', { name: 'Unrelated' });

      await companionImport(() => {
        if (edited) store.segments.addSegment('base', { name: 'My edit' });
        store.replaceConfigSegments({ Other: {} }, []);
      });

      expect(segmentNames('base')).toEqual(
        edited
          ? ['Lung', 'Unrelated', 'My edit', 'labelmap']
          : ['Lung', 'labelmap']
      );
      expect(serializeAnnotations().seedSegmentDefaults).toEqual([
        { name: 'Other' },
      ]);
    }
  );

  it.each([
    { version: '7.0.0' },
    { version: '8.0.0' },
    { version: '8.0.0', segments: [] },
    { version: '8.0.0', segments: [], imageSegmentSets: [] },
  ])(
    'initializes artifact-only images from configured defaults: %j',
    async (wire) => {
      const store = useSegmentStore();
      store.replaceConfigSegments({ Site: {} }, []);
      await viewImage('existing');
      store.segments.addSegment('existing', { name: 'Unrelated' });
      await viewImage('destination-a');
      await seatImage('destination-b');
      const image = await seatImage('artifact', {
        values: new Uint8Array(64).fill(1),
      });
      const segmentation = useSegmentationStore();
      const deserialize = segmentation.deserialize;
      vi.spyOn(segmentation, 'deserialize').mockImplementation((options) =>
        deserialize({
          ...options,
          io: { read: async () => ({ image }), write: async () => '' },
        })
      );
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
      await completeStateFileRestore(
        ManifestSchema.parse(migrated.manifest),
        ids.map((id) => ({
          archivePath: `${id}.vti`,
          file: new File([], `${id}.vti`),
        })),
        { a: 'destination-a', b: 'destination-b' },
        { migration: migrated.migration }
      );

      ids.forEach((id) => {
        expect(savedSegmentNames(`destination-${id}`)).toEqual([
          'Site',
          `Mask ${id}`,
        ]);
        expect(segmentation.imageMasks(`destination-${id}`)).toHaveLength(1);
      });
      await showImage('destination-b');
      expect(savedSegmentNames('destination-b')).toEqual(['Site', 'Mask b']);
      expect(savedSegmentNames('existing')).toEqual(['Site', 'Unrelated']);
    }
  );

  it('keeps defaults separate when two sessions share an import map', async () => {
    await seatImage('destination-a');
    await seatImage('destination-b');
    const dataIDMap = { a: 'destination-a', b: 'destination-b' };

    await completeStateFileRestore(
      manifestForImages(['a'], { seedSegmentDefaults: [{ name: 'Tumor' }] }),
      [],
      dataIDMap
    );
    await completeStateFileRestore(
      manifestForImages(['b'], {
        seedSegmentDefaults: [{ name: 'Kidney' }],
        segments: [
          {
            id: 'kidney',
            name: 'Kidney',
            color: [1, 2, 3, 255],
            visible: true,
            locked: false,
          },
        ],
        imageSegmentSets: [{ imageId: 'b', segmentIds: ['kidney'] }],
      }),
      [],
      dataIDMap
    );

    expect(savedSegmentNames('destination-a')).toEqual(['Tumor']);
    expect(savedSegmentNames('destination-b')).toEqual(['Kidney']);
  });

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

      expect(savedSegmentNames('destination')).toEqual(['Previous']);
      expect(views.visibleViews.map(({ dataID }) => dataID)).toEqual([
        'destination',
      ]);
      if (activeSlot !== undefined)
        expect(views.visibleViews.map(({ id }) => id)).toEqual([activeView]);
    }
  );

  it.each(['new segment', 'paint'])(
    'keeps a copy edited by a %s before the companion segmentation lands',
    async (action) => {
      await viewImage('existing');
      useSegmentStore().segments.mintSegment('existing', { name: 'Liver' });

      await companionImport(() => {
        if (action === 'new segment')
          useSegmentStore().segments.addSegment('base', { name: 'New' });
        else useSegmentationStore().resolveEditTarget('base');
      });

      expect(segmentNames('base')).toEqual(
        expect.arrayContaining(
          action === 'new segment' ? ['Liver', 'New'] : ['Liver']
        )
      );
      expect(segmentNames('base')).toHaveLength(
        action === 'new segment' ? 3 : 2
      );
    }
  );

  it('replaces an untouched copy with a restored set', async () => {
    await viewImage('existing');
    useSegmentStore().segments.mintSegment('existing', { name: 'Liver' });
    await viewImage('destination');
    expect(segmentNames('destination')).toEqual(['Liver']);

    await completeStateFileRestore(
      manifestForImages(['incoming'], {
        primarySelection: 'incoming',
        segments: [
          {
            id: 's1',
            name: 'Tumor',
            color: [1, 2, 3, 255],
            visible: true,
            locked: false,
          },
        ],
        imageSegmentSets: [{ imageId: 'incoming', segmentIds: ['s1'] }],
      }),
      [],
      { incoming: 'destination' }
    );

    expect(segmentNames('destination')).toEqual(['Tumor']);
    expect(segmentNames('existing')).toEqual(['Liver']);
  });
});
