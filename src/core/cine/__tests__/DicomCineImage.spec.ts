import { describe, expect, it } from 'vitest';
import {
  fromBlob,
  readInstance,
  Tags,
  type ByteSource,
  type DicomDataset,
} from '@/packages/dicom/core';
import { buildSyntheticCineDicom } from '@/tests/specs/syntheticDicom';
import { datasetFromTags } from '@/tests/dicomDataset';
import DicomCineImage from '../DicomCineImage';
import { cineInstance, TS_JPEG_BASELINE } from './cineFixtures';

type Region = Record<'deltaX' | 'deltaY' | 'unitsX' | 'unitsY', string>;

const regionSequence = (regions: Region[]): DicomDataset['elements'] => [
  {
    tag: '00186011',
    group: 0x0018,
    element: 0x6011,
    vr: 'SQ',
    values: {
      kind: 'sequence',
      items: regions.map((region) =>
        datasetFromTags([
          [Tags.PhysicalDeltaX, region.deltaX],
          [Tags.PhysicalDeltaY, region.deltaY],
          [Tags.PhysicalUnitsXDirection, region.unitsX],
          [Tags.PhysicalUnitsYDirection, region.unitsY],
        ])
      ),
    },
  },
];

const spacingOf = (image: DicomCineImage) =>
  Array.from(image.getVtkImageData().getSpacing());

/** Starts loading and settles with the first error or completion. */
const load = (image: DicomCineImage) => {
  const errors: Error[] = [];
  const settled = new Promise<void>((resolve) => {
    image.addEventListener('error', (error) => {
      errors.push(error);
      resolve();
    });
    image.addEventListener('status', (status) => {
      if (status === 'complete') resolve();
    });
  });
  image.startLoad();
  return settled.then(() => errors);
};

const scalarsOf = (image: DicomCineImage) =>
  Array.from(image.getVtkImageData().getPointData().getScalars().getData());

describe('DicomCineImage spacing', () => {
  it('uses the first spatial 2D ultrasound region instead of the first region overall', () => {
    const image = new DicomCineImage(
      cineInstance(
        { [Tags.PixelSpacing]: '1.8\\0.45' },
        {
          elements: regionSequence([
            { deltaX: '10', deltaY: '10', unitsX: '1', unitsY: '3' },
            { deltaX: '-0.05', deltaY: '0.125', unitsX: '3', unitsY: '3' },
          ]),
        }
      )
    );

    expect(spacingOf(image)).toEqual([0.5, 1.25, 1]);
    image.dispose();
  });

  it('falls back to DICOM PixelSpacing in VTK axis order when no spatial ultrasound region is available', () => {
    const image = new DicomCineImage(
      cineInstance({ [Tags.PixelSpacing]: '1.8\\0.45' })
    );

    expect(spacingOf(image)).toEqual([0.45, 1.8, 1]);
    image.dispose();
  });
});

describe('DicomCineImage loading', () => {
  it('shows the first frame of a Part 10 clip once loading starts', async () => {
    const bytes = buildSyntheticCineDicom({
      studyUid: '1.2.3',
      seriesUid: '1.2.3.4',
      sopUid: '1.2.3.4.5',
      numberOfFrames: 3,
      rows: 2,
      cols: 3,
    });
    const image = new DicomCineImage(
      await readInstance(
        fromBlob(new Blob([bytes as BlobPart])),
        new AbortController().signal
      )
    );

    expect(await load(image)).toEqual([]);
    expect(image.getVtkImageData().getDimensions()).toEqual([3, 2, 1]);
    // The synthetic clip's samples count up from zero; gray replicates to RGB.
    expect(scalarsOf(image)).toEqual(
      [0, 1, 2, 3, 4, 5].flatMap((value) => [value, value, value])
    );
    expect(image.getStatus()).toBe('complete');
    image.dispose();
  });

  it('reports pixel data it cannot cut into frames as one load error', async () => {
    const image = new DicomCineImage(
      cineInstance(
        {},
        {
          transferSyntaxUid: TS_JPEG_BASELINE,
          pixels: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]),
        }
      )
    );

    const errors = await load(image);

    expect(errors.map(({ message }) => message)).toEqual([
      expect.stringMatching(/Malformed encapsulated Pixel Data/),
    ]);
    expect(image.isLoading()).toBe(false);
    expect(image.getStatus()).toBe('incomplete');
    image.dispose();
  });

  it('reports native pixel data shorter than its frames', async () => {
    const image = new DicomCineImage(
      cineInstance({}, { pixels: new Uint8Array(4) })
    );

    const errors = await load(image);

    expect(errors.map(({ message }) => message)).toEqual([
      expect.stringMatching(/Pixel Data holds 4 bytes; its frames need 8/),
    ]);
    image.dispose();
  });

  it('reads the pixels again when a load is retried after a failed read', async () => {
    const pixels = fromBlob(
      new Blob([Uint8Array.from([9, 9, 9, 9, 8, 8, 8, 8])])
    );
    const reads: AbortSignal[] = [];
    const source: ByteSource = {
      read: (signal, range) => {
        reads.push(signal);
        if (reads.length === 1)
          return new ReadableStream({
            start: (controller) => controller.error(new Error('offline')),
          });
        return pixels.read(signal, range);
      },
    };
    const image = new DicomCineImage({ ...cineInstance(), source });

    expect((await load(image)).map(({ message }) => message)).toEqual([
      'offline',
    ]);
    expect(await load(image)).toEqual([]);
    expect(scalarsOf(image)).toEqual(Array(12).fill(9));
    image.dispose();
  });

  it('makes a thumbnail once a read that failed succeeds on retry', async () => {
    const pixels = fromBlob(
      new Blob([Uint8Array.from([9, 9, 9, 9, 8, 8, 8, 8])])
    );
    let reads = 0;
    const source: ByteSource = {
      read: (signal, range) => {
        reads += 1;
        if (reads === 1)
          return new ReadableStream({
            start: (controller) => controller.error(new Error('offline')),
          });
        return pixels.read(signal, range);
      },
    };
    const image = new DicomCineImage(
      { ...cineInstance(), source },
      undefined,
      ({ width, height, rgb }) => `${width}x${height}:${rgb.join(',')}`
    );
    image.addEventListener('error', () => {});

    expect(await image.getThumbnail()).toBeNull();
    expect(await load(image)).toEqual([]);
    expect(await image.getThumbnail()).toBe(`2x2:${Array(12).fill(9)}`);
    image.dispose();
  });

  it('aborts its pixel read when disposed', () => {
    const reads: AbortSignal[] = [];
    const source: ByteSource = {
      read: (signal) => {
        reads.push(signal);
        return new ReadableStream({ pull: () => new Promise(() => {}) });
      },
    };
    const image = new DicomCineImage({ ...cineInstance(), source });

    image.startLoad();
    image.dispose();

    expect(reads).toHaveLength(1);
    expect(reads[0].aborted).toBe(true);
  });
});
