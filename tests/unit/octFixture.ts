import dicomParser from 'dicom-parser';
import { Chunk } from '@/src/core/streaming/chunk';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import { DicomFileMetaLoader } from '@/src/core/streaming/dicom/dicomFileMetaLoader';
import { DicomFileDataLoader } from '@/src/core/streaming/dicom/dicomFileDataLoader';
import { Tags, toDicomParserKey } from '@/src/core/dicomTags';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useViewStore } from '@/src/store/views';
import { untilLoaded } from '@/src/composables/untilLoaded';
import type { Maybe } from '@/src/types';

import {
  createSyntheticOCT,
  overwriteDicomString,
} from '../fixtures/oct/dicom';

/** Reads the named VolView tags, standing in for the itk-wasm tag reader. */
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

/** Uses synthetic pixels and production chunk/file loaders without a browser WASM worker. */
export function createOCTFixture(
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
  const file = new File([bytes], 'synthetic-oct.dcm');
  const chunk = new Chunk({
    metaLoader: new DicomFileMetaLoader(file, readDicomTags),
    dataLoader: new DicomFileDataLoader(file),
  });
  let releaseDecode = () => {};
  const decodeGate = new Promise<void>((resolve) => {
    releaseDecode = resolve;
  });
  if (!options.deferDecode) releaseDecode();
  const image = new DicomChunkImage({
    splitAndSort: async (chunks) => ({ fixture: chunks }),
    readDicomImage: async (input) => {
      await decodeGate;
      const source = new Uint8Array(await input.arrayBuffer());
      const data = dicomParser.parseDicom(source);
      const pixel = data.elements.x7fe00010;
      const values = new DataView(
        source.buffer,
        pixel.dataOffset,
        pixel.length
      );
      const scalars = Uint16Array.from(
        { length: pixel.length / 2 },
        (_, index) => values.getUint16(index * 2, true)
      );
      return {
        image: {
          size: [
            data.uint16('x00280011')!,
            data.uint16('x00280010')!,
            data.intString('x00280008')!,
          ],
          data: scalars,
          imageType: { components: data.uint16('x00280002')! },
        },
      };
    },
  });
  return { image, chunk, releaseDecode };
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
  const fixture = createOCTFixture(options);
  releases.push(fixture.releaseDecode);
  useImageCacheStore().addProgressiveImage(fixture.image, { id });
  await fixture.chunk.loadMeta();
  await fixture.image.addChunks([fixture.chunk]);
  fixture.image.startLoad();
  if (!options.deferDecode) await untilLoaded(id);
  return id;
}
