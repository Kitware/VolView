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
import { useImageCacheStore } from '@/src/store/image-cache';
import { useViewStore } from '@/src/store/views';
import { useRulerStore } from '@/src/store/tools/rulers';
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

  it.each(['new segment', 'paint', 'annotation'])(
    'preserves the pending copy before the first %s edit',
    async (action) => {
      await viewImage('a');
      const store = useSegmentStore();
      store.segments.addSegment('a', { name: 'Liver' });
      const release = store.deferInitialization(['b']);
      await viewImage('b');

      if (action === 'new segment')
        store.segments.addSegment('b', { name: 'New' });
      else if (action === 'paint')
        useSegmentationStore().resolveEditTarget('b');
      else {
        const rulers = useRulerStore();
        const tool = rulers.addTool({ imageID: 'b', placing: true });
        rulers.resolveToolSegment(tool);
      }
      release();

      expect(segmentNames('b')).toEqual(
        action === 'new segment' ? ['Liver', 'New'] : ['Liver']
      );
      expect(segmentNames('a')).toEqual(['Liver']);
    }
  );

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

  it('keeps the first activation snapshot while nested loads and focus changes finish', async () => {
    await viewImage('a');
    const store = useSegmentStore();
    const source = store.segments.mintSegment('a', {
      name: 'Initial',
      color: [1, 2, 3, 255],
      locked: true,
      visible: false,
    });
    await seatImage('b');
    await seatImage('c');
    const releaseOuter = store.deferInitialization(['b', 'b', 'c']);
    const releaseInner = store.deferInitialization(['b', 'c']);
    await showImage('b');
    store.segments.updateSegment(source, {
      name: 'Later',
      color: [4, 5, 6, 255],
    });
    await showImage('c');
    await showImage('a');
    await showImage('b');
    releaseInner();
    releaseInner();
    expect(segmentNames('b')).toEqual([]);
    releaseOuter();

    expect(segmentNames('a')).toEqual(['Later']);
    expect(segmentNames('b')).toEqual(['Initial']);
    expect(segmentNames('c')).toEqual(['Initial']);
    expect(store.segments.segmentList('b')[0]).toMatchObject({
      color: [1, 2, 3, 255],
      visible: true,
      locked: false,
    });
  });

  it('copies an existing image before its first edit during an unrelated load', async () => {
    await viewImage('a');
    const store = useSegmentStore();
    const source = store.segments.addSegment('a', { name: 'Liver' });
    await seatImage('b');
    const release = store.deferInitialization(['c']);

    await showImage('b');

    expect(segmentNames('b')).toEqual(['Liver']);
    const selected = store.segments.selectedSegmentId('b');
    expect(selected).toBeDefined();
    expect(selected).not.toBe(source);
    const segmentation = useSegmentationStore();
    const target = segmentation.resolveEditTarget('b');
    expect(segmentation.getMask(target).segmentId).toBe(selected);

    release();

    expect(segmentNames('b')).toEqual(['Liver']);
    expect(store.segments.selectedSegmentId('b')).toBe(selected);
    expect(segmentNames('a')).toEqual(['Liver']);
  });

  it('keeps the pending copy when a standalone config adds definitions', async () => {
    await viewImage('a');
    const store = useSegmentStore();
    store.segments.addSegment('a', { name: 'Liver' });
    const release = store.deferInitialization(['b']);
    await viewImage('b');

    await importDataSources([
      {
        type: 'file',
        fileType: 'application/json',
        file: new File(
          [JSON.stringify({ segments: { Tumor: {} } })],
          'segments.json'
        ),
      },
    ]);
    release();

    expect(segmentNames('a')).toEqual(['Liver']);
    expect(segmentNames('b')).toEqual(['Liver', 'Tumor']);
  });

  it('reserves new images until their own imported definitions arrive', async () => {
    await viewImage('a');
    const store = useSegmentStore();
    store.segments.addSegment('a', { name: 'Liver' });
    const imported = await store.withDeferredImageInitialization(
      async (reserveImage) => {
        reserveImage('incoming');
        reserveImage('incoming');
        await seatImage('incoming');
        await showImage('incoming');

        expect(segmentNames('incoming')).toEqual([]);
        expect(
          serializeAnnotations().imageSegmentSets?.some(
            ({ imageId }) => imageId === 'incoming'
          )
        ).toBe(false);
        return store.segments.mintSegment('incoming', { name: 'Tumor' });
      }
    );

    expect(segmentNames('incoming')).toEqual(['Tumor']);
    expect(store.segments.selectedSegmentId('incoming')).toBe(imported);
    expect(segmentNames('a')).toEqual(['Liver']);
  });

  it('initializes a completed image from defaults while another destination is reserved', async () => {
    const store = useSegmentStore();
    store.replaceConfigSegments({ Liver: { color: '#ff0000' } }, []);
    const release = store.deferInitialization(['c']);
    await seatImage('c');

    await viewImage('b');

    expect(segmentNames('b')).toEqual(['Liver']);
    const target = useSegmentationStore().resolveEditTarget('b');
    const selected = store.segments.selectedSegmentId('b');
    expect(useSegmentationStore().getMask(target).segmentId).toBe(selected);
    release();
    expect(segmentNames('b')).toEqual(['Liver']);
  });

  it('releases operation destinations when an import fails', async () => {
    await viewImage('a');
    const store = useSegmentStore();
    store.segments.addSegment('a', { name: 'Liver' });

    await expect(
      store.withDeferredImageInitialization(async (reserveImage) => {
        reserveImage('incoming');
        reserveImage('incoming');
        await seatImage('incoming');
        await showImage('incoming');
        expect(segmentNames('incoming')).toEqual([]);
        throw new Error('Import failed');
      })
    ).rejects.toThrow('Import failed');

    expect(segmentNames('incoming')).toEqual(['Liver']);
    expect(segmentNames('a')).toEqual(['Liver']);
  });

  it('settles a destination while a different destination remains reserved', async () => {
    await viewImage('a');
    const store = useSegmentStore();
    store.segments.addSegment('a', { name: 'Liver' });
    await seatImage('b');
    await seatImage('c');
    const releaseB = store.deferInitialization(['b']);
    const releaseC = store.deferInitialization(['c']);
    await showImage('b');
    await showImage('a');
    await showImage('c');

    releaseB();

    expect(segmentNames('b')).toEqual(['Liver']);
    expect(segmentNames('c')).toEqual([]);
    releaseB();
    expect(segmentNames('c')).toEqual([]);
    releaseC();
    expect(segmentNames('c')).toEqual(['Liver']);
  });

  it('saves independently initialized destination sets', async () => {
    const store = useSegmentStore();
    const imageIds = Array.from(
      { length: 24 },
      (_, index) => `pending-${index}`
    );
    const releases = imageIds.map((imageId) =>
      store.deferInitialization([imageId])
    );
    for (const imageId of imageIds) {
      await seatImage(imageId);
      await showImage(imageId);
    }

    releases.forEach((release) => release());

    expect(serializeAnnotations().imageSegmentSets).toEqual(
      imageIds.map((imageId) => ({ imageId, segmentIds: [] }))
    );
  });

  it('does not publish a pending set after its image is deleted', async () => {
    await viewImage('existing');
    const store = useSegmentStore();
    store.segments.addSegment('existing', { name: 'Liver' });
    const release = store.deferInitialization(['incoming']);
    await viewImage('incoming');
    useImageCacheStore().removeImage('incoming');

    release();

    expect(
      serializeAnnotations().imageSegmentSets?.some(
        ({ imageId }) => imageId === 'incoming'
      )
    ).toBe(false);
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

  it('waits for a directly displayed image segmentation before considering borrowed rows', async () => {
    await viewImage('existing');
    useSegmentStore().segments.mintSegment('existing', { name: 'Unrelated' });
    await seatImage('base');
    await seatImage('labelmap', { values: new Uint8Array(64).fill(1) });
    const store = useSegmentationStore();
    const convert = store.startLabelmapConversion;
    const entered = defer<void>();
    const released = defer<void>();
    vi.spyOn(store, 'startLabelmapConversion').mockImplementation(
      (imageId, parentId, options) =>
        convert(imageId, parentId, {
          ...options,
          resample: async (_parent, image) => {
            entered.resolve();
            await released.promise;
            return image;
          },
        })
    );
    const showing = showImportedData([
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
    released.resolve();
    await showing!.completed;
    expect(pendingNames).toEqual([]);
    expect(segmentNames('base')).toHaveLength(1);
    expect(segmentNames('base')).not.toContain('Unrelated');
    expect(store.imageMasks('base')).toHaveLength(1);
    expect(segmentNames('existing')).toEqual(['Unrelated']);
  });
});
