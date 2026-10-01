import { readFileSync } from 'node:fs';
import { URL as FileURL } from 'node:url';
import dicomParser from 'dicom-parser';
import { Chunk } from '@/src/core/streaming/chunk';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import { DicomFileMetaLoader } from '@/src/core/streaming/dicom/dicomFileMetaLoader';
import { DicomFileDataLoader } from '@/src/core/streaming/dicom/dicomFileDataLoader';
import { Tags } from '@/src/core/dicomTags';

const fixtureURL = new FileURL(
  '../fixtures/oct/retina-derived.dcm',
  import.meta.url
);

/** Uses real fixture pixels and production chunk/file loaders without a browser WASM worker. */
export function createOCTFixture(
  options: { scanPattern?: string; deferDecode?: boolean } = {}
) {
  const bytes = Uint8Array.from(readFileSync(fixtureURL));
  if (options.scanPattern) {
    const data = dicomParser.parseDicom(bytes, { untilTag: 'x7fe00010' });
    const pattern =
      data.elements.x00221618.items![0].dataSet!.elements.x00080100;
    const replacement = new TextEncoder().encode(options.scanPattern);
    if (replacement.length > pattern.length)
      throw new Error('Fixture scan code is too long');
    bytes.fill(0x20, pattern.dataOffset, pattern.dataOffset + pattern.length);
    bytes.set(replacement, pattern.dataOffset);
  }
  const file = new File([bytes], 'retina-derived.dcm');
  const chunk = new Chunk({
    metaLoader: new DicomFileMetaLoader(file, async (input) => {
      const data = dicomParser.parseDicom(
        new Uint8Array(await input.arrayBuffer()),
        { untilTag: 'x7fe00010' }
      );
      return Object.values(Tags).flatMap((tag): Array<[string, string]> => {
        const key = `x${tag.replace('|', '')}`;
        const element = data.elements[key];
        if (!element || element.vr === 'SQ') return [];
        const value =
          element.vr === 'US' ? String(data.uint16(key)) : data.string(key);
        return value === undefined ? [] : [[tag, value]];
      });
    }),
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
