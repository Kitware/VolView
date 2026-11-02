import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { showImportedData } from '@/src/actions/loadUserFiles';
import { asLoadableResult } from '@/src/io/import/common';
import { importDataSources } from '@/src/io/import/importDataSources';
import { completeStateFileRestore } from '@/src/io/import/processors/restoreStateFile';
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
import { defer } from '@/src/utils';
import { Skip } from '@/src/utils/evaluateChain';

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

  it.each([
    [],
    [{ name: 'Session', color: [1, 2, 3, 255], visible: true, locked: false }],
  ])(
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
        seedSegmentDefaults: [
          { name: 'Fallback', visible: true, locked: false },
        ],
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
