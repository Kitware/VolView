import dicomParser from 'dicom-parser';
import {
  readInstance,
  type Instance,
} from '@/packages/dicom/core/instance/readInstance';
import { fromBlob } from '@/packages/dicom/core/source/byteSource';
import { readGeometryFacts } from '@/packages/dicom/core/collections/instanceFacts';
import type { DicomCollection } from '@/packages/dicom/core/collections/planDicomCollections';
import { allocateVolume } from '@/packages/dicom/core/volume/allocateVolume';
import {
  createDicomRuntime,
  type PixelDecoder,
} from '@/packages/dicom/core/runtime/createDicomRuntime';
import DicomVolumeImage from '@/src/core/streaming/dicomVolumeImage';
import {
  Tags,
  toDicomParserKey,
} from '@/packages/dicom/core/metadata/dicomTags';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useViewStore } from '@/src/store/views';
import { untilLoaded } from '@/src/composables/untilLoaded';
import type { Maybe } from '@/src/types';

import {
  createSyntheticOCT,
  overwriteDicomString,
} from '../fixtures/oct/dicom';

/** Reads raw named tags for assertions, independently of the structured loader. */
export async function readDicomTags(file: Blob) {
  const data = dicomParser.parseDicom(
    new Uint8Array(await file.arrayBuffer()),
    {
      untilTag: 'x7fe00010',
    }
  );
  return Object.values(Tags).flatMap((tag): Array<[string, string]> => {
    const key = toDicomParserKey(tag);
    const element = data.elements[key];
    if (!element || element.vr === 'SQ') return [];
    const value =
      element.vr === 'US' ? String(data.uint16(key)) : data.string(key);
    return value === undefined ? [] : [[tag, value]];
  });
}

/** Reads a file's header the way the importer does, on the main thread. */
export const readFixtureInstance = (file: Blob) =>
  readInstance(fromBlob(file), new AbortController().signal);

/**
 * Allocates these instances in the given order as one volume. Fixtures keep
 * deliberate groups, so geometry is judged by allocation, not by the planner.
 */
export function volumeOf(instances: Instance[]) {
  const { orientation } = readGeometryFacts(instances[0].dataset);
  const allocation = allocateVolume({
    id: 'fixture',
    members: instances,
    collection: { orientation } as DicomCollection,
  });
  if (allocation.kind !== 'volume')
    throw new Error(`Expected a volume, got ${allocation.kind}`);
  return allocation.volume;
}

// Decodes every frame of an uncompressed little endian 16 bit instance.
const decodeOCT: PixelDecoder = async ({ bytes }) => {
  const data = dicomParser.parseDicom(bytes);
  const pixel = data.elements.x7fe00010;
  const values = new DataView(
    bytes.buffer,
    bytes.byteOffset + pixel.dataOffset,
    pixel.length
  );
  return {
    size: [
      data.uint16('x00280011')!,
      data.uint16('x00280010')!,
      data.intString('x00280008')!,
    ],
    data: Uint16Array.from({ length: pixel.length / 2 }, (_, index) =>
      values.getUint16(index * 2, true)
    ),
    imageType: { components: data.uint16('x00280002')! },
  };
};

/** Uses synthetic pixels and the production header reader without a WASM worker. */
export async function createOCTFixture(
  options: { scanPattern?: string; deferDecode?: boolean } = {}
) {
  const bytes = Uint8Array.from(createSyntheticOCT());
  if (options.scanPattern) {
    const data = dicomParser.parseDicom(bytes, { untilTag: 'x7fe00010' });
    overwriteDicomString(
      data.elements.x00221618.items![0].dataSet!,
      'x00080100',
      options.scanPattern
    );
  }
  const instance = await readFixtureInstance(
    new File([bytes], 'synthetic-oct.dcm')
  );
  let releaseDecode = () => {};
  const decodeGate = new Promise<void>((resolve) => {
    releaseDecode = resolve;
  });
  if (!options.deferDecode) releaseDecode();
  const image = new DicomVolumeImage({
    runtime: createDicomRuntime({
      decoder: async (request, signal) => {
        await decodeGate;
        return decodeOCT(request, signal);
      },
    }),
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
