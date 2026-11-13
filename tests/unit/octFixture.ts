import {
  allocateVolume,
  createDicomRuntime,
  fromBlob,
  getDatasetTag,
  readInstance,
  type Instance,
  type InstanceCollectionUpdate,
  type WholeInstanceDecode,
} from '@/packages/dicom/core';
import { decodingWith, plannedUpdate } from '@/tests/dicomVolumeFixtures';
import DicomVolumeImage from '@/src/core/streaming/dicomVolumeImage';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useViewStore } from '@/src/store/views';
import { untilLoaded } from '@/src/composables/untilLoaded';
import type { Maybe } from '@/src/types';

import { createSyntheticOCT } from '../fixtures/oct/dicom';

/** Reads a file's header the way the importer does, on the main thread. */
export const readFixtureInstance = (file: Blob) =>
  readInstance(fromBlob(file), new AbortController().signal);

/**
 * Allocates these instances in the given order as one volume. Fixtures keep
 * deliberate groups, so geometry is judged by allocation, not by the planner.
 */
export function volumeOf(instances: Instance[]) {
  // The first member planned alone gives the validated orientation.
  const { orientation } = plannedUpdate([instances[0]]).collection;
  return allocateVolume({
    kind: 'image',
    id: 'fixture',
    members: instances,
    collection: { orientation } as InstanceCollectionUpdate['collection'],
  });
}

// Decodes every frame of an uncompressed little endian 16 bit instance.
const decodeOCT: WholeInstanceDecode = ({ instance, bytes }) => {
  const { valueOffset, length } = instance.pixelData!;
  const values = new DataView(bytes.buffer, bytes.byteOffset + valueOffset);
  const count = (tag: string, fallback?: number) =>
    Number(getDatasetTag(instance.dataset, tag) ?? fallback);
  return {
    size: [count('00280011'), count('00280010'), count('00280008', 1)],
    data: Uint16Array.from({ length: length! / 2 }, (_, index) =>
      values.getUint16(index * 2, true)
    ),
    components: count('00280002', 1),
  };
};

/** Uses synthetic pixels and the production header reader without a WASM worker. */
export async function createOCTFixture(
  options: { scanPattern?: string; deferDecode?: boolean } = {}
) {
  const bytes = Uint8Array.from(
    createSyntheticOCT({ scanPattern: options.scanPattern })
  );
  const instance = await readFixtureInstance(
    new File([bytes], 'synthetic-oct.dcm')
  );
  let releaseDecode = () => {};
  const decodeGate = new Promise<void>((resolve) => {
    releaseDecode = resolve;
  });
  if (!options.deferDecode) releaseDecode();
  const image = new DicomVolumeImage({
    runtime: createDicomRuntime(
      decodingWith(async (request, signal) => {
        await decodeGate;
        return decodeOCT(request, signal);
      })
    ),
  });
  return { image, instance, releaseDecode };
}

/** Replaces the first layout view with an active En face view of `dataID`. */
export function activateEnFace(dataID: Maybe<string>) {
  const views = useViewStore();
  views.replaceView(views.layoutViews[0].id, {
    name: 'En face',
    type: 'EnFace',
    dataID,
    options: {},
  });
  const viewID = views.layoutViews[0].id;
  views.setActiveView(viewID);
  return viewID;
}

/** Caches and loads a synthetic OCT; `releases` collects its decode gate for cleanup. */
export async function loadOCT(
  releases: (() => void)[],
  id = 'retina-oct',
  options: Parameters<typeof createOCTFixture>[0] = {}
) {
  const fixture = await createOCTFixture(options);
  releases.push(fixture.releaseDecode);
  fixture.image.setVolume(volumeOf([fixture.instance]));
  useImageCacheStore().addProgressiveImage(fixture.image, { id });
  if (!options.deferDecode) await untilLoaded(id);
  return id;
}
