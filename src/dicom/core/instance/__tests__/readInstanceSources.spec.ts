import { describe, expect, it } from 'vitest';
import { readInstance } from '../readInstance';
import { Tags } from '../../metadata/dicomTags';
import { findElement, readDicomDataset } from '../../metadata/dicomDataset';
import { getDatasetTag } from '../../metadata/datasetAccess';
import { sequenceItems } from '../../metadata/functionalGroups';
import { readUltrasoundRegions } from '../../metadata/ultrasoundRegion';
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
const CHUNK = 256;

/** A dataset reader that records the header bytes it is handed. */
const recordingReader = () => {
  const seen: Uint8Array[] = [];
  const readDataset = (header: Uint8Array) => {
    seen.push(header);
    return { elements: [], specificCharacterSet: null };
  };
  return { seen, readDataset };
};

const largeSlice = () =>
  syntheticSlice({
    rows: 64,
    cols: 64,
    modality: 'MR',
    patientName: 'DOE^JANE',
    extraElements: [
      rawElement(0x0029, 0x0010, 'LO', new TextEncoder().encode('VENDOR')),
    ],
  });

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

  it('reads the header and where Pixel Data starts', async () => {
    const bytes = largeSlice();
    const { source } = trackedSource(bytes, CHUNK);

    const instance = await readInstance(source, never());

    expect(instance.source).toBe(source);
    expect(getDatasetTag(instance.dataset, '00100010')).toBe('DOE^JANE');
    const start = pixelDataStart(bytes);
    expect(instance.pixelData).toEqual({
      offset: start,
      valueOffset: start + 12,
      length: bytes.length - start - 12,
      vr: 'OW',
    });
    expect(instance.transferSyntaxUid).toBe(EXPLICIT_VR_LITTLE_ENDIAN);
    expect(Object.isFrozen(instance)).toBe(true);
  });

  it('stops pulling bytes at the header and cancels the stream', async () => {
    const bytes = largeSlice();
    const { source, stats } = trackedSource(bytes, CHUNK);

    await readInstance(source, never());

    expect(stats.cancelled).toBe(1);
    expect(stats.delivered).toBeLessThanOrEqual(
      pixelDataStart(bytes) + 2 * CHUNK
    );
    expect(stats.delivered).toBeLessThan(bytes.length / 2);
  });

  it('reads nothing once its signal has aborted', async () => {
    const { source, stats } = trackedSource(largeSlice(), CHUNK);
    const controller = new AbortController();
    controller.abort(new DOMException('stop', 'AbortError'));

    await expect(readInstance(source, controller.signal)).rejects.toMatchObject(
      { name: 'AbortError' }
    );
    expect(stats.reads).toBe(0);
  });

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
    ['explicit', false, EXPLICIT_VR_LITTLE_ENDIAN, 12],
    ['implicit', true, IMPLICIT_VR_LITTLE_ENDIAN, 8],
  ])(
    'reads a bare %s VR data set in the transfer syntax its opening suggests',
    async (_kind, implicitVr, transferSyntaxUid, headLength) => {
      const bytes = syntheticSlice({
        patientName: 'DOE^JOHN',
        implicitVr,
        rows: 4,
        cols: 4,
      });
      const bare = stripFileMeta(bytes);
      const pixelBytes = 4 * 4 * 2;

      const instance = await readHeader(bare, 64);

      expect(instance.dataset).toEqual(readDicomDataset(bytes));
      expect(instance.layout).toEqual({
        preamble: false,
        fileMeta: false,
        transferSyntaxUid,
      });
      expect(instance.transferSyntaxUid).toBe(transferSyntaxUid);
      expect(instance.pixelData).toEqual({
        offset: bare.length - pixelBytes - headLength,
        valueOffset: bare.length - pixelBytes,
        length: pixelBytes,
        vr: 'OW',
      });
    }
  );

  it('parses nothing when the stream fails before the header ends', async () => {
    const bytes = syntheticSlice();
    const { seen, readDataset } = recordingReader();
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
      readInstance(failing, never(), { readDataset })
    ).rejects.toThrow('connection reset');
    expect(seen).toEqual([]);
  });

  it('hands the dataset reader the header bytes, once', async () => {
    const bytes = syntheticSlice();
    const { seen, readDataset } = recordingReader();

    await readInstance(trackedSource(bytes).source, never(), { readDataset });

    expect(seen).toEqual([bytes.slice(0, pixelDataStart(bytes))]);
  });

  it('takes tags and ultrasound regions from one read', async () => {
    const bytes = syntheticSlice({ modality: 'US', ultrasoundRegion: REGION });
    const { source, stats } = trackedSource(bytes);

    const instance = await readInstance(source, never());

    expect(instance.dataset).toEqual(readDicomDataset(bytes));
    const regions = readUltrasoundRegions(instance.dataset);
    expect(regions.regionCount).toBe(1);
    expect(regions.region?.physicalDeltaX).toBeCloseTo(REGION.physicalDeltaX);
    expect(regions.region?.physicalDeltaY).toBeCloseTo(REGION.physicalDeltaY);
    expect(stats.reads).toBe(1);
  });

  it('reads every tag of an object that has no Pixel Data', async () => {
    const bytes = withoutPixelData(syntheticSlice({ modality: 'SR' }));

    const { dataset, transferSyntaxUid, pixelData } = await readHeader(bytes);

    expect(dataset).toEqual(readDicomDataset(bytes));
    expect(dataset.elements.length).toBeGreaterThan(1);
    expect(pixelData).toBeNull();
    expect(transferSyntaxUid).toBe(EXPLICIT_VR_LITTLE_ENDIAN);
  });

  it.each([
    { name: 'Float Pixel Data', element: 0x0008, vr: 'OF' },
    { name: 'Double Float Pixel Data', element: 0x0009, vr: 'OD' },
  ])('stops at $name without locating it', async ({ element, vr }) => {
    const header = withoutPixelData(syntheticSlice({ modality: 'MR' }));
    const bytes = concatBytes([
      header,
      rawElement(0x7fe0, element, vr, new Uint8Array(64 * 1024)),
    ]);
    const { source, stats } = trackedSource(bytes, CHUNK);

    const { dataset, pixelData } = await readInstance(source, never());

    expect(dataset).toEqual(readDicomDataset(header));
    expect(pixelData).toBeNull();
    expect(stats.delivered).toBeLessThan(bytes.length / 2);
  });

  it('reads a radiotherapy object no further than its modality', async () => {
    const bytes = syntheticSlice({ modality: 'RTDOSE', patientName: 'DOE' });
    const skipped = trackedSource(bytes, 32);

    const shortcut = await readInstance(skipped.source, never());

    expect(getDatasetTag(shortcut.dataset, Tags.Modality)?.trim()).toBe(
      'RTDOSE'
    );
    expect(getDatasetTag(shortcut.dataset, '00100010')).toBeUndefined();
    expect(shortcut.pixelData).toBeNull();
    expect(skipped.stats.delivered).toBeLessThan(pixelDataStart(bytes));
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
