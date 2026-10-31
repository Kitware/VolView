import { describe, expect, it } from 'vitest';
import { DicomMetaLoader } from '../dicomMetaLoader';
import { StopSignal } from '../../cachedStreamFetcher';
import type { Fetcher } from '../../types';
import { Tags } from '../../../metadata/dicomTags';
import { readDicomDataset } from '../../../metadata/dicomDataset';
import { getDatasetTag } from '../../../metadata/datasetAccess';
import {
  EXPLICIT_VR_LITTLE_ENDIAN,
  IMPLICIT_VR_LITTLE_ENDIAN,
} from '../../../metadata/dicomLayout';
import {
  rawElement,
  sequenceItem,
  stripFileMeta,
  stripPreamble,
  toImplicitVr,
  undefinedLengthItem,
  undefinedLengthUnknown,
} from '@/tests/specs/syntheticDicom';
import {
  bytesFetcher,
  countingFetcher,
  deliveredBytes,
  pixelDataStart,
  syntheticSlice,
  withoutPixelData,
} from '@/tests/dicomSourceFixtures';

const REGION = { physicalDeltaX: 0.0625, physicalDeltaY: 0.125 };

/** A source that delivers `after` bytes and then stops, as a cancel does. */
const stoppingFetcher = (bytes: Uint8Array, after: number): Fetcher => ({
  ...bytesFetcher(bytes),
  getStream: () => {
    let delivered = false;
    return new ReadableStream<Uint8Array>({
      pull: (controller) => {
        if (delivered) {
          controller.error(StopSignal);
          return;
        }
        delivered = true;
        controller.enqueue(bytes.slice(0, after));
      },
    });
  },
});

describe('DicomMetaLoader over a byte source', () => {
  it.each([
    { name: 'defined-length item', item: sequenceItem },
    { name: 'undefined-length item', item: undefinedLengthItem },
  ])(
    'reads an undefined-length UN with $name across stream boundaries',
    async ({ item }) => {
      // A nonempty item catches treating the UN contents as Explicit VR.
      // The value also contains delimiter-like bytes that must stay data.
      const payload = new Uint8Array([
        0xfe, 0xff, 0xdd, 0xe0, 0, 0, 0, 0, 0xfe, 0xff, 0x0d, 0xe0, 0, 0, 0, 0,
      ]);
      const content = toImplicitVr(rawElement(0x0043, 0x1030, 'OB', payload));
      const bytes = syntheticSlice({
        extraElements: [
          rawElement(0x0043, 0x0010, 'LO', new TextEncoder().encode('TEST')),
          undefinedLengthUnknown(0x0043, 0x1029, item(content)),
        ],
      });
      const loader = new DicomMetaLoader(bytesFetcher(bytes, 7));

      await loader.load();

      expect(
        readDicomDataset(bytes).elements.find((el) => el.tag === '00431029')
          ?.values
      ).toMatchObject({
        kind: 'sequence',
        items: [
          {
            elements: [
              { tag: '00431030', values: { kind: 'bytes', values: [payload] } },
            ],
          },
        ],
      });
      expect(loader.meta).toEqual(readDicomDataset(bytes));
      expect(loader.pixelDataOffset).toBe(pixelDataStart(bytes));
    }
  );

  it('reads the file tags with the JS reader by default', async () => {
    const bytes = syntheticSlice({ patientName: 'DOE^JOHN', modality: 'CT' });
    const loader = new DicomMetaLoader(bytesFetcher(bytes));

    await loader.load();

    expect(loader.meta).toEqual(readDicomDataset(bytes));
  });

  it('stops at Pixel Data', async () => {
    const bytes = syntheticSlice();
    const loader = new DicomMetaLoader(bytesFetcher(bytes));

    await loader.load();

    expect(loader.pixelDataOffset).toBe(pixelDataStart(bytes));
    expect(loader.fileLayout).toEqual({ preamble: true, fileMeta: true });
  });

  it('reads a source without a preamble as the Part 10 file it came from', async () => {
    const bytes = syntheticSlice({ patientName: 'DOE^JOHN' });
    const loader = new DicomMetaLoader(bytesFetcher(stripPreamble(bytes), 64));

    await loader.load();

    expect(loader.meta).toEqual(readDicomDataset(bytes));
    expect(loader.fileLayout).toEqual({ preamble: false, fileMeta: true });
  });

  it.each([
    ['explicit', false, EXPLICIT_VR_LITTLE_ENDIAN],
    ['implicit', true, IMPLICIT_VR_LITTLE_ENDIAN],
  ])(
    'reads a bare %s VR data set with its transfer syntax assumed',
    async (_kind, implicitVr, transferSyntaxUid) => {
      const bytes = syntheticSlice({ patientName: 'DOE^JOHN', implicitVr });
      const loader = new DicomMetaLoader(
        bytesFetcher(stripFileMeta(bytes), 64)
      );

      await loader.load();

      expect(loader.meta).toEqual(readDicomDataset(bytes));
      expect(loader.fileLayout).toEqual({
        preamble: false,
        fileMeta: false,
        transferSyntaxUid,
      });
    }
  );

  it('reads nothing as a header when stopped before the header ends', async () => {
    const bytes = syntheticSlice();
    const seen: Uint8Array[] = [];
    const loader = new DicomMetaLoader(stoppingFetcher(bytes, 64), (header) => {
      seen.push(header);
      return { elements: [], specificCharacterSet: null };
    });

    await expect(loader.load()).rejects.toThrow(/stopped/);

    expect(seen).toEqual([]);
    expect(loader.meta).toBeUndefined();
  });

  it('leaves the byte source undelivered past Pixel Data', async () => {
    const bytes = syntheticSlice();
    const fetcher = bytesFetcher(bytes, 64);
    const loader = new DicomMetaLoader(fetcher);

    await loader.load();

    expect(loader.meta).toEqual(readDicomDataset(bytes));
    expect(deliveredBytes(fetcher)).toBeLessThan(bytes.length);
  });

  it('hands the reader the header bytes, once', async () => {
    const bytes = syntheticSlice();
    const seen: Uint8Array[] = [];
    const loader = new DicomMetaLoader(bytesFetcher(bytes), (headerBytes) => {
      seen.push(headerBytes);
      return { elements: [], specificCharacterSet: null };
    });

    await loader.load();
    await loader.load();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(Uint8Array);
    expect(seen[0]).toEqual(bytes.slice(0, pixelDataStart(bytes)));
  });

  it('takes tags, offset and ultrasound regions from one pass', async () => {
    const bytes = syntheticSlice({ modality: 'US', ultrasoundRegion: REGION });
    const { fetcher, counts } = countingFetcher(bytesFetcher(bytes));
    const loader = new DicomMetaLoader(fetcher);

    await loader.load();

    expect(loader.meta).toEqual(readDicomDataset(bytes));
    expect(loader.pixelDataOffset).toBe(pixelDataStart(bytes));
    expect(loader.ultrasoundRegions?.regionCount).toBe(1);
    expect(loader.ultrasoundRegions?.region?.physicalDeltaX).toBeCloseTo(
      REGION.physicalDeltaX
    );
    expect(loader.ultrasoundRegions?.region?.physicalDeltaY).toBeCloseTo(
      REGION.physicalDeltaY
    );
    // One stream, and never the whole blob: the regions cost no second read.
    expect(counts.getStream).toBe(1);
    expect(counts.blob).toBe(0);
  });

  it('reports no ultrasound regions for a non-ultrasound modality', async () => {
    const bytes = syntheticSlice({ modality: 'MR', ultrasoundRegion: REGION });
    const loader = new DicomMetaLoader(bytesFetcher(bytes));

    await loader.load();

    expect(loader.ultrasoundRegions).toBeUndefined();
  });

  it('reads every tag of an object that has no Pixel Data', async () => {
    const bytes = withoutPixelData(syntheticSlice({ modality: 'SR' }));
    const loader = new DicomMetaLoader(bytesFetcher(bytes));

    await loader.load();

    expect(loader.meta).toEqual(readDicomDataset(bytes));
    expect(loader.meta!.elements.length).toBeGreaterThan(1);
    expect(loader.pixelDataOffset).toBe(bytes.length);
  });

  // A structure set is megabytes of contours the importer drops unread, so
  // the loader stops at the modality that says so.
  it('reads a radiotherapy object no further than its modality', async () => {
    const bytes = withoutPixelData(syntheticSlice({ modality: 'RTSTRUCT' }));
    const fetcher = bytesFetcher(bytes, 32);
    const seen: Uint8Array[] = [];
    const loader = new DicomMetaLoader(
      fetcher,
      (header) => {
        seen.push(header);
        return readDicomDataset(header);
      },
      'skip-radiotherapy'
    );

    await loader.load();

    expect(getDatasetTag(loader.meta, Tags.Modality)?.trim()).toBe('RTSTRUCT');
    expect(seen).toHaveLength(1);
    expect(deliveredBytes(fetcher)).toBeLessThan(bytes.length);
    expect(loader.pixelDataOffset).toBeUndefined();
  });

  it('closes the byte source once the header is read', async () => {
    const { fetcher, counts } = countingFetcher(bytesFetcher(syntheticSlice()));
    const loader = new DicomMetaLoader(fetcher);

    await loader.load();

    expect(counts.close).toBeGreaterThanOrEqual(1);
  });

  it('closes the byte source on stop', async () => {
    const { fetcher, counts } = countingFetcher(bytesFetcher(syntheticSlice()));
    const loader = new DicomMetaLoader(fetcher);

    await loader.stop();

    expect(counts.close).toBeGreaterThanOrEqual(1);
  });

  it('rejects a byte source that is not DICOM', async () => {
    const loader = new DicomMetaLoader(bytesFetcher(new Uint8Array(512)));

    await expect(loader.load()).rejects.toThrow();
  });
});
