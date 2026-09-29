import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import JSZip from 'jszip';

import { MANIFEST, serialize } from '@/src/io/state-file/serialize';
import { ManifestSchema } from '@/src/io/state-file/schema';
import {
  addMask,
  inMemoryArtifactIO,
  seatImage,
  seedVoxel,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { useSegmentStore } from '@/src/segmentation/segments';
import { seatDataSource } from '@/src/store/__tests__/datasetFixtures';
import { useRulerStore } from '@/src/store/tools/rulers';
import { defer } from '@/src/utils';

const readManifest = async (blob: Blob) => {
  const zip = await JSZip.loadAsync(blob);
  return ManifestSchema.parse(
    JSON.parse(await zip.file(MANIFEST)!.async('string'))
  );
};

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => vi.restoreAllMocks());

it.each(['encoding', 'queued update'])(
  'saves matching annotation identities when edited during %s',
  async (phase) => {
    await seatImage('ct');
    seatDataSource('ct', { type: 'uri', uri: '/ct.nrrd', name: 'ct.nrrd' });
    const maskId = addMask('ct', 'Original');
    seedVoxel(maskId, [0, 0, 0]);
    const segments = useSegmentStore();
    const originalSegment = store().getMask(maskId).segmentId;
    segments.segments.updateSegment(originalSegment, {
      color: [0, 0, 255, 255],
    });
    const rulers = useRulerStore();
    const rulerId = rulers.addRuler({
      imageID: 'ct',
      firstPoint: [0, 0, 0],
      secondPoint: [3, 0, 0],
      segmentId: originalSegment,
    });
    const reassign = () => {
      const segmentId = segments.segments.mintSegment({
        name: 'Tumor',
        color: [255, 0, 0, 255],
      });
      rulers.updateRuler(rulerId, { segmentId });
    };
    const writeSegments = segments.serialize;
    const segmentWriter = vi
      .spyOn(segments, 'serialize')
      .mockImplementation((state) => {
        writeSegments(state);
        if (phase === 'queued update') queueMicrotask(reassign);
      });
    const io = inMemoryArtifactIO();
    const entered = defer<void>();
    const released = defer<void>();
    const writeMasks = store().serialize;
    vi.spyOn(store(), 'serialize').mockImplementation((state) =>
      writeMasks(state, {
        read: io.read,
        write: async (...args) => {
          const bytes = await io.write(args[0], args[1]);
          entered.resolve();
          await released.promise;
          return bytes;
        },
      })
    );

    const saving = serialize();
    await entered.promise;
    if (phase === 'encoding') reassign();
    released.resolve();
    const saved = await readManifest(await saving);
    segmentWriter.mockRestore();

    const later = await readManifest(await serialize());
    const laterRuler = later.tools!.rulers!.tools[0];
    expect(
      later.segments?.find(({ id }) => id === laterRuler.segmentId)
    ).toMatchObject({ name: 'Tumor', color: [255, 0, 0, 255] });

    setActivePinia(createPinia());
    await seatImage('restored');
    const { segmentIdMap } = useSegmentStore().deserialize(saved);
    const restored = useRulerStore();
    restored.deserialize(saved, { ct: 'restored' }, segmentIdMap);
    const [ruler] = restored.serializeTools().tools;
    expect(ruler).toMatchObject({
      imageID: 'restored',
      firstPoint: [0, 0, 0],
      secondPoint: [3, 0, 0],
    });
    expect(restored.appearanceOfTool(restored.rulers[0].id)).toMatchObject({
      name: 'Original',
      color: [0, 0, 255, 255],
    });
  }
);
