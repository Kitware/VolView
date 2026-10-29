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
    const releaseOuter = store.deferInitialization();
    const releaseInner = store.deferInitialization();
    await showImage('b');
    store.segments.updateSegment(source, {
      name: 'Later',
      color: [4, 5, 6, 255],
    });
    await showImage('c');
    await showImage('a');
    await showImage('b');
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
