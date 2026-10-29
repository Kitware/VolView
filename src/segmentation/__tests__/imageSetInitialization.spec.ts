import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { showImportedData } from '@/src/actions/loadUserFiles';
import { asLoadableResult } from '@/src/io/import/common';
import { importDataSources } from '@/src/io/import/importDataSources';
import { completeStateFileRestore } from '@/src/io/import/processors/restoreStateFile';
import {
  manifestForImages,
  seatImage,
  showImage,
  viewImage,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useImageCacheStore } from '@/src/store/image-cache';
import { defer } from '@/src/utils';
import { Skip } from '@/src/utils/evaluateChain';

const names = (imageId: string) =>
  useSegmentStore()
    .segments.segmentList(imageId)
    .map(({ name }) => name);

describe('image segment initialization boundaries', () => {
  beforeEach(() => setActivePinia(createPinia()));
  afterEach(() => vi.restoreAllMocks());

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
    expect(names('b')).toEqual([]);
    releaseOuter();

    expect(names('a')).toEqual(['Later']);
    expect(names('b')).toEqual(['Initial']);
    expect(names('c')).toEqual(['Initial']);
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

    expect(names('b')).toEqual(['Liver']);
    const selected = store.segments.selectedSegmentId('b');
    expect(selected).toBeDefined();
    expect(selected).not.toBe(source);
    const segmentation = useSegmentationStore();
    const target = segmentation.resolveEditTarget('b');
    expect(segmentation.getMask(target).segmentId).toBe(selected);

    release();

    expect(names('b')).toEqual(['Liver']);
    expect(store.segments.selectedSegmentId('b')).toBe(selected);
    expect(names('a')).toEqual(['Liver']);
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

        expect(names('incoming')).toEqual([]);
        expect(store.segments.imageSets.value.incoming).toBeUndefined();
        return store.segments.mintSegment('incoming', { name: 'Tumor' });
      }
    );

    expect(names('incoming')).toEqual(['Tumor']);
    expect(store.segments.selectedSegmentId('incoming')).toBe(imported);
    expect(names('a')).toEqual(['Liver']);
  });

  it('initializes a completed image from defaults while another destination is reserved', async () => {
    const store = useSegmentStore();
    store.replaceConfigSegments({ Liver: { color: '#ff0000' } });
    const release = store.deferInitialization(['c']);
    await seatImage('c');

    await viewImage('b');

    expect(names('b')).toEqual(['Liver']);
    const target = useSegmentationStore().resolveEditTarget('b');
    const selected = store.segments.selectedSegmentId('b');
    expect(useSegmentationStore().getMask(target).segmentId).toBe(selected);
    release();
    expect(names('b')).toEqual(['Liver']);
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
        expect(names('incoming')).toEqual([]);
        throw new Error('Import failed');
      })
    ).rejects.toThrow('Import failed');

    expect(names('incoming')).toEqual(['Liver']);
    expect(names('a')).toEqual(['Liver']);
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

    expect(names('b')).toEqual(['Liver']);
    expect(names('c')).toEqual([]);
    releaseB();
    expect(names('c')).toEqual([]);
    releaseC();
    expect(names('c')).toEqual(['Liver']);
  });

  it('does bounded image-cache work when releasing independent destinations', async () => {
    const store = useSegmentStore();
    const imageCache = useImageCacheStore();
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

    // Count cache reads before publishing a set, independent of lease storage.
    let cacheReads = 0;
    imageIds.forEach((imageId) => {
      const image = imageCache.imageById[imageId];
      Object.defineProperty(imageCache.imageById, imageId, {
        configurable: true,
        get: () => {
          cacheReads += 1;
          return image;
        },
      });
    });
    releases.forEach((release) => release());

    expect(
      imageIds.every((imageId) => store.segments.imageSets.value[imageId])
    ).toBe(true);
    expect(cacheReads).toBeLessThanOrEqual(2 * imageIds.length);
  });

  it('does not publish a pending set after its image is deleted', async () => {
    await viewImage('existing');
    const store = useSegmentStore();
    store.segments.addSegment('existing', { name: 'Liver' });
    const release = store.deferInitialization(['incoming']);
    await viewImage('incoming');
    useImageCacheStore().removeImage('incoming');

    release();

    expect(store.segments.imageSets.value.incoming).toBeUndefined();
    expect(names('existing')).toEqual(['Liver']);
  });

  it('restores an explicit empty set without borrowing from the current image', async () => {
    await viewImage('existing');
    useSegmentStore().segments.mintSegment('existing', { name: 'Existing' });
    await seatImage('destination');
    const manifest = manifestForImages(['incoming'], {
      primarySelection: 'incoming',
      segments: [],
      imageSegmentSets: [{ imageId: 'incoming', segmentIds: [] }],
    });
    await completeStateFileRestore(manifest, [], { incoming: 'destination' });
    expect(names('destination')).toEqual([]);
    expect(names('existing')).toEqual(['Existing']);
    expect(useSegmentStore().segments.imageSets.value.destination).toEqual({
      segmentIds: [],
    });
  });

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
    expect(names('new-image')).toEqual(['Configured']);
    expect(names('existing')).toEqual(['Existing']);
    expect(
      useSegmentStore().seedSegmentDefaults.map(({ name }) => name)
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
    const displaying = showImportedData([
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
    const pendingNames = names('base');
    released.resolve();
    await displaying;
    expect(pendingNames).toEqual([]);
    expect(names('base')).toHaveLength(1);
    expect(names('base')).not.toContain('Unrelated');
    expect(store.imageMasks('base')).toHaveLength(1);
    expect(names('existing')).toEqual(['Unrelated']);
  });
});
