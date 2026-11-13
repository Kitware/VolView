import { describe, expect, it } from 'vitest';
import { readInstance } from '../readInstance';
import { Tags } from '../../metadata/dicomTags';
import { findElement, readDicomDataset } from '../../metadata/dicomDataset';
import { getDatasetTag } from '../../metadata/datasetAccess';
import { sequenceItems } from '../../metadata/functionalGroups';
import {
  EXPLICIT_VR_LITTLE_ENDIAN,
  IMPLICIT_VR_LITTLE_ENDIAN,
} from '../../metadata/dicomLayout';
import { fromBlob, fromUrl, readBytes } from '../../source/byteSource';
import { trackedSource } from '@/tests/byteSourceFixtures';
import { concatBytes } from '../../utils';
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
  pixelDataStart,
  readHeader,
  syntheticSlice,
  withoutPixelData,
} from '@/tests/dicomSourceFixtures';

const REGION = { physicalDeltaX: 0.0625, physicalDeltaY: 0.125 };
const never = () => new AbortController().signal;

describe('readInstance over byte sources', () => {
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

      const { dataset } = await readHeader(bytes, 7);

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
      expect(dataset).toEqual(readDicomDataset(syntheticSlice()));
    }
  );

  it('reads a Part 10 file with its layout', async () => {
    const bytes = syntheticSlice({ patientName: 'DOE^JOHN', modality: 'CT' });

    const instance = await readHeader(bytes);

    expect(instance.dataset).toEqual(readDicomDataset(bytes));
    expect(instance.layout).toEqual({ preamble: true, fileMeta: true });
  });

  it('reads a source without a preamble as the Part 10 file it came from', async () => {
    const bytes = syntheticSlice({ patientName: 'DOE^JOHN' });

    const instance = await readHeader(stripPreamble(bytes), 64);

    expect(instance.dataset).toEqual(readDicomDataset(bytes));
    expect(instance.layout).toEqual({ preamble: false, fileMeta: true });
  });

  it.each([
    ['explicit', false, EXPLICIT_VR_LITTLE_ENDIAN],
    ['implicit', true, IMPLICIT_VR_LITTLE_ENDIAN],
  ])(
    'reads a bare %s VR data set with its transfer syntax assumed',
    async (_kind, implicitVr, transferSyntaxUid) => {
      const bytes = syntheticSlice({ patientName: 'DOE^JOHN', implicitVr });

      const instance = await readHeader(stripFileMeta(bytes), 64);

      expect(instance.dataset).toEqual(readDicomDataset(bytes));
      expect(instance.layout).toEqual({
        preamble: false,
        fileMeta: false,
        transferSyntaxUid,
      });
    }
  );

  it('parses nothing when the stream fails before the header ends', async () => {
    const bytes = syntheticSlice();
    const seen: Uint8Array[] = [];
    const failing = {
      read: () =>
        new ReadableStream<Uint8Array>({
          start: (controller) => {
            controller.enqueue(bytes.slice(0, 64));
            controller.error(new Error('connection reset'));
          },
        }),
    };

    await expect(
      readInstance(failing, never(), {
        readDataset: (header) => {
          seen.push(header);
          return { elements: [], specificCharacterSet: null };
        },
      })
    ).rejects.toThrow('connection reset');
    expect(seen).toEqual([]);
  });

  it('hands the dataset reader the header bytes, once', async () => {
    const bytes = syntheticSlice();
    const seen: Uint8Array[] = [];

    await readInstance(trackedSource(bytes).source, never(), {
      readDataset: (header) => {
        seen.push(header);
        return { elements: [], specificCharacterSet: null };
      },
    });

    expect(seen).toEqual([bytes.slice(0, pixelDataStart(bytes))]);
  });

  it('takes tags and ultrasound regions from one read', async () => {
    const bytes = syntheticSlice({ modality: 'US', ultrasoundRegion: REGION });
    const { source, stats } = trackedSource(bytes);

    const instance = await readInstance(source, never());

    expect(instance.dataset).toEqual(readDicomDataset(bytes));
    expect(instance.ultrasoundRegions?.regionCount).toBe(1);
    expect(instance.ultrasoundRegions?.region?.physicalDeltaX).toBeCloseTo(
      REGION.physicalDeltaX
    );
    expect(instance.ultrasoundRegions?.region?.physicalDeltaY).toBeCloseTo(
      REGION.physicalDeltaY
    );
    expect(stats.reads).toBe(1);
  });

  it('reports no ultrasound regions for a non-ultrasound modality', async () => {
    const bytes = syntheticSlice({ modality: 'MR', ultrasoundRegion: REGION });

    expect((await readHeader(bytes)).ultrasoundRegions).toBeNull();
  });

  it('reads every tag of an object that has no Pixel Data', async () => {
    const bytes = withoutPixelData(syntheticSlice({ modality: 'SR' }));

    const { dataset } = await readHeader(bytes);

    expect(dataset).toEqual(readDicomDataset(bytes));
    expect(dataset.elements.length).toBeGreaterThan(1);
  });

  it('reads a radiotherapy object without Pixel Data no further than its modality', async () => {
    const bytes = withoutPixelData(syntheticSlice({ modality: 'RTSTRUCT' }));
    const { source, stats } = trackedSource(bytes, 32);

    const { dataset } = await readInstance(source, never(), {
      imageImportPolicy: 'skip-radiotherapy',
    });

    expect(getDatasetTag(dataset, Tags.Modality)?.trim()).toBe('RTSTRUCT');
    expect(stats.delivered).toBeLessThan(bytes.length);
  });

  it('rejects a byte source that is not DICOM', async () => {
    await expect(readHeader(new Uint8Array(512))).rejects.toThrow();
  });

  it('drops private payloads, nested ones too, while the source keeps every byte', async () => {
    const privateElement = rawElement(
      0x0029,
      0x1010,
      'OB',
      new Uint8Array(100_000).fill(0x41)
    );
    const bytes = syntheticSlice({
      extraElements: [
        privateElement,
        rawElement(
          0x0008,
          0x1140,
          'SQ',
          sequenceItem(
            concatBytes([
              rawElement(8, 0x1155, 'UI', new TextEncoder().encode('1.2.3\0')),
              privateElement,
            ])
          )
        ),
      ],
    });
    const source = fromBlob(new Blob([bytes as BlobPart]));

    const { dataset } = await readInstance(source, never());

    expect(findElement(readDicomDataset(bytes), '00291010')).toBeDefined();
    expect(findElement(dataset, '00291010')).toBeUndefined();
    const reference = sequenceItems(dataset, '00081140')[0];
    expect(getDatasetTag(reference, '00081155')).toBe('1.2.3');
    expect(findElement(reference, '00291010')).toBeUndefined();
    expect(await readBytes(source, never())).toEqual(bytes);
  });

  it('reads only the header from an HTTP response', async () => {
    const bytes = syntheticSlice({
      patientName: 'DOE^JOHN',
      rows: 64,
      cols: 64,
    });
    const served = trackedSource(bytes, 256);
    const source = fromUrl('https://example.test/slice.dcm', {
      fetch: async () => new Response(served.source.read(never())),
    });

    const { dataset } = await readInstance(source, never());

    expect(getDatasetTag(dataset, '00100010')).toBe('DOE^JOHN');
    expect(served.stats.delivered).toBeLessThan(bytes.length / 2);
  });
});
