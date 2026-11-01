import dicomParser, { type DataSet } from 'dicom-parser';
import { deflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Tags } from '@/src/core/dicomTags';
import { augmentOCTMetadata } from '@/src/core/streaming/dicom/octMetadata';
import { allocateImageFromChunks } from '@/src/utils/allocateImageFromChunks';
import type { Chunk } from '@/src/core/streaming/chunk';

import { deflatedExplicitVR } from '@/tests/fixtures/oct/volumes';
import {
  isOCTMetadata,
  OCT_GEOMETRY_ERROR,
  OCT_SCAN_PATTERN,
  OPHTHALMIC_TOMOGRAPHY_SOP,
  OPHTHALMIC_BSCAN_ANALYSIS_SOP,
  OPHTHALMIC_EN_FACE_SOP,
} from '@/src/core/streaming/dicom/octMetadataTags';

import reference from '@/tests/fixtures/oct/reference.json';
import {
  createSyntheticOCT,
  element,
  enhancedFile,
  sequence,
  overwriteDicomString,
} from '@/tests/fixtures/oct/dicom';

const baseMetadata = (): Array<[string, string]> => [
  [Tags.SOPClassUID, OPHTHALMIC_TOMOGRAPHY_SOP],
  [Tags.Modality, 'OPT'],
];

afterEach(() => vi.restoreAllMocks());

const firstItem = (data: DataSet, tag: string) =>
  data.elements[tag].items![0].dataSet!;

function fixtureBytes() {
  return new Uint8Array(createSyntheticOCT());
}

function readDataset(bytes: Uint8Array) {
  return dicomParser.parseDicom(bytes, { untilTag: 'x7fe00010' });
}

function hide(data: DataSet, tag: string) {
  const attribute = data.elements[tag];
  // Explicit-VR DS headers are 8 bytes. Rename to an unused private group.
  const start = attribute.dataOffset - 8;
  data.byteArray[start] = 0x77;
  data.byteArray[start + 1] = 0x77;
}

const spatialMetadataError = (metadata: Iterable<[string, string]>) =>
  new Map(metadata).get(OCT_GEOMETRY_ERROR);

async function augmented(bytes = fixtureBytes()) {
  return new Map(
    await augmentOCTMetadata(new Blob([bytes as BlobPart]), baseMetadata())
  );
}

function recordBlobReads() {
  const reads: number[] = [];
  const arrayBuffer = Blob.prototype.arrayBuffer;
  vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementation(function (
    this: Blob
  ) {
    reads.push(this.size);
    return arrayBuffer.call(this);
  });
  return reads;
}

describe('OCT DICOM activation', () => {
  it('recognizes ophthalmic tomography and OCT B-scan analysis SOP classes', () => {
    expect(isOCTMetadata([[Tags.SOPClassUID, OPHTHALMIC_TOMOGRAPHY_SOP]])).toBe(
      true
    );
    expect(
      isOCTMetadata([[Tags.SOPClassUID, OPHTHALMIC_BSCAN_ANALYSIS_SOP]])
    ).toBe(true);
    expect(isOCTMetadata([[Tags.Modality, 'OPT ']])).toBe(true);
  });

  it('does not activate a volume projection for an existing enface image', () => {
    expect(
      isOCTMetadata([
        [Tags.SOPClassUID, OPHTHALMIC_EN_FACE_SOP],
        [Tags.Modality, 'OPT'],
      ])
    ).toBe(false);
  });

  it.each(['OCT', 'OT', 'CT', 'MR', 'OP'])(
    'does not treat modality %s alone as an OCT volume',
    (modality) => {
      expect(isOCTMetadata([[Tags.Modality, modality]])).toBe(false);
    }
  );

  it('preserves metadata and skips parsing non-OCT files', async () => {
    const tags: Array<[string, string]> = [[Tags.Modality, 'CT']];
    expect(await augmentOCTMetadata(new Blob(['not a DICOM']), tags)).toBe(
      tags
    );
  });
});

describe('OCT enhanced spatial metadata', () => {
  it('reads the header without copying the volume pixels', async () => {
    const source = fixtureBytes();
    const expected = await augmented(source);
    const reads = recordBlobReads();

    expect(await augmented(source)).toEqual(expected);
    expect(reads.reduce((total, bytes) => total + bytes, 0)).toBeLessThan(
      source.length / 10
    );
  });

  it('reads large OCT headers without copying the pixel payload', async () => {
    const frames = [{ position: '0\\0\\0' }, { position: '0\\0\\0.2' }];
    const expected = new Map(
      await augmentOCTMetadata(enhancedFile(frames), baseMetadata())
    );
    const file = new Blob([
      enhancedFile(frames, [
        element('00111010', 'OB', new Uint8Array(2 * 1024 * 1024)),
      ]),
      element('7fe00010', 'OW', new Uint8Array(16 * 1024 * 1024)),
    ]);
    const reads = recordBlobReads();

    expect(new Map(await augmentOCTMetadata(file, baseMetadata()))).toEqual(
      expected
    );
    expect(reads.reduce((total, bytes) => total + bytes, 0)).toBeLessThan(
      file.size / 2
    );
  });

  it.each([64 * 1024, 2 * 1024 * 1024])(
    'retains geometry after metadata ending at byte %s',
    async (end) => {
      const frames = [{ position: '0\\0\\0' }, { position: '0\\0\\0.2' }];
      const empty = new Uint8Array(
        await enhancedFile(frames, [
          element('00111010', 'OB', new Uint8Array()),
        ]).arrayBuffer()
      );
      const start = readDataset(empty).elements.x00111010.dataOffset;
      const header = enhancedFile(frames, [
        element('00111010', 'OB', new Uint8Array(end - start)),
      ]);
      const file = new Blob([
        header,
        element('7fe00010', 'OW', new Uint8Array(2)),
      ]);
      expect(new Map(await augmentOCTMetadata(file, baseMetadata()))).toEqual(
        new Map(await augmentOCTMetadata(enhancedFile(frames), baseMetadata()))
      );
    }
  );

  it('uses the complete deflated stream when it exceeds the header probe', async () => {
    const source = fixtureBytes();
    const bytes = deflatedExplicitVR(source, (dataset) =>
      deflateRawSync(dataset, { level: 0 })
    );
    expect(bytes.length).toBeGreaterThan(64 * 1024);
    expect(await augmented(bytes)).toEqual(await augmented(source));
  });

  it('reads deflated Explicit VR geometry with the required trailing NULL padding', async () => {
    const source = new Uint8Array(
      await enhancedFile([
        { position: '0\\0\\0' },
        { position: '0\\0\\0.2' },
      ]).arrayBuffer()
    );
    let streamLength = 0;
    const bytes = deflatedExplicitVR(source, (dataset) => {
      expect(dataset.length).toBeLessThan(65536);
      // A final stored DEFLATE block adds five bytes to the even DICOM dataset.
      const header = Buffer.alloc(5);
      header[0] = 1;
      header.writeUInt16LE(dataset.length, 1);
      header.writeUInt16LE(~dataset.length & 0xffff, 3);
      const stream = Buffer.concat([header, dataset]);
      streamLength = stream.length;
      return stream;
    });
    expect(streamLength % 2).toBe(1);
    expect(bytes.length % 2).toBe(0);
    expect(bytes.at(-1)).toBe(0);
    expect(await augmented(bytes)).toEqual(await augmented(source));
  });

  it('records unreadable spatial metadata when the deflated dataset is truncated', async () => {
    const bytes = deflatedExplicitVR(fixtureBytes());
    expect(
      spatialMetadataError(await augmented(bytes.subarray(0, -10)))
    ).toMatch(/could not be read/);
  });

  it.each([
    { preamble: 0x20, groupLength: true },
    { preamble: 0xff, groupLength: true },
    { preamble: 0, groupLength: false },
  ])('reads deflated geometry with %j', async ({ preamble, groupLength }) => {
    const source = fixtureBytes();
    let bytes = deflatedExplicitVR(source);
    bytes.fill(preamble, 0, 128);
    if (!groupLength)
      bytes = Buffer.concat([bytes.subarray(0, 132), bytes.subarray(144)]);
    expect(await augmented(bytes)).toEqual(await augmented(source));
  });

  it('reads the generated OCT fixture and promotes nested geometry', async () => {
    const tags = await augmented();
    const pixelSpacing = tags.get(Tags.PixelSpacing)!.split('\\').map(Number);
    expect(pixelSpacing).toEqual([reference.spacing[1], reference.spacing[0]]);
    expect(Number(tags.get(Tags.SpacingBetweenSlices))).toBeCloseTo(
      reference.spacing[2],
      10
    );
    expect(tags.get(Tags.ImageOrientationPatient)).toBe(
      '1.0\\0.0\\0.0\\0.0\\1.0\\0.0'
    );
    expect(tags.get(Tags.ImagePositionPatient)).toBe('0\\0\\0');
    expect(tags.get(Tags.OphthalmicVolumetricPropertiesFlag)).toBe('YES');
    expect(tags.get(OCT_SCAN_PATTERN)).toBe('128280');
    expect(spatialMetadataError(tags)).toBeUndefined();
  });

  it('preserves declared scan patterns such as radial scans', async () => {
    const bytes = fixtureBytes();
    const data = readDataset(bytes);
    overwriteDicomString(firstItem(data, 'x00221618'), 'x00080100', '128282');
    const tags = await augmented(bytes);
    expect(isOCTMetadata(tags)).toBe(true);
    expect(tags.get(OCT_SCAN_PATTERN)).toBe('128282');
  });

  it.each(['128280', '128282'])(
    'reads B-scan analysis scan pattern %s from its acquisition parameters',
    async (pattern) => {
      const file = enhancedFile(
        [{}, {}],
        [
          element('00180088', 'DS', '0.2'),
          sequence('00221640', [
            sequence('00221618', [element('00080100', 'SH', pattern)]),
          ]),
        ]
      );
      const tags = new Map(
        await augmentOCTMetadata(file, [
          [Tags.SOPClassUID, OPHTHALMIC_BSCAN_ANALYSIS_SOP],
        ])
      );
      expect(tags.get(OCT_SCAN_PATTERN)).toBe(pattern);
    }
  );

  it('reads nested acquisition scan patterns with implicit VR', async () => {
    const implicit = (encoded: Uint8Array) =>
      Buffer.concat([encoded.subarray(0, 4), encoded.subarray(8)]);
    const attribute = (tag: string, value: string) =>
      implicit(element(tag, 'OB', value));
    const file = new Blob([
      Buffer.alloc(128),
      Buffer.from('DICM'),
      element('00020010', 'UI', '1.2.840.10008.1.2'),
      attribute('00280008', '2'),
      attribute('00180088', '0.2'),
      implicit(
        sequence('00221640', [
          implicit(sequence('00221618', [attribute('00080100', '128282')])),
        ])
      ),
    ]);
    const tags = new Map(
      await augmentOCTMetadata(file, [
        [Tags.SOPClassUID, OPHTHALMIC_BSCAN_ANALYSIS_SOP],
      ])
    );
    expect(tags.get(OCT_SCAN_PATTERN)).toBe('128282');
  });

  it('marks multiple acquisition patterns as requiring reconstruction', async () => {
    const raster = sequence('00221618', [element('00080100', 'SH', '128280')]);
    const file = enhancedFile(
      [{}, {}],
      [element('00180088', 'DS', '0.2'), sequence('00221640', [raster, raster])]
    );
    expect(
      new Map(await augmentOCTMetadata(file, baseMetadata())).get(
        OCT_SCAN_PATTERN
      )
    ).toBe('multiple');
  });

  it('preserves declarations marking a volume unsuitable for volumetric processing', async () => {
    const bytes = fixtureBytes();
    overwriteDicomString(readDataset(bytes), 'x00221622', 'NO');
    expect(
      (await augmented(bytes)).get(Tags.OphthalmicVolumetricPropertiesFlag)
    ).toBe('NO');
  });

  it('preserves missing pixel spacing for the loader fallback', async () => {
    const bytes = fixtureBytes();
    const data = readDataset(bytes);
    const shared = firstItem(data, 'x52009229');
    const measures = firstItem(shared, 'x00289110');
    hide(data, 'x00280030');
    hide(measures, 'x00280030');
    const tags = await augmented(bytes);
    expect(isOCTMetadata(tags)).toBe(true);
    expect(spatialMetadataError(tags)).toBeUndefined();
    expect(tags.has(Tags.PixelSpacing)).toBe(false);
  });

  it('rejects a per-frame geometry count that disagrees with NumberOfFrames', async () => {
    const bytes = fixtureBytes();
    overwriteDicomString(readDataset(bytes), 'x00280008', '31');
    expect(spatialMetadataError(await augmented(bytes))).toMatch(
      /frame.*count|number.*frames/i
    );
  });

  it.each([
    [2, 0, 0, 0, 0.5, 0],
    [1, 0, 0, 0.5, 1, 0],
    [1.001, 0, 0, 0, 1, 0],
    [1, 0, 0, 0.001, 1, 0],
  ])(
    'rejects direction cosines that would distort physical thickness %#',
    async (...orientation) => {
      const bytes = fixtureBytes();
      const data = readDataset(bytes);
      const shared = firstItem(data, 'x52009229');
      overwriteDicomString(
        firstItem(shared, 'x00209116'),
        'x00200037',
        orientation.join('\\')
      );
      expect(spatialMetadataError(await augmented(bytes))).toMatch(
        /orientation|orthonormal|direction/i
      );
    }
  );

  it.each(['position', 'orientation', 'nonunit orientation'])(
    'preserves top-level geometry when enhanced %s is invalid',
    async (kind) => {
      const bytes = fixtureBytes();
      const data = readDataset(bytes);
      if (kind === 'position') {
        overwriteDicomString(
          firstItem(firstItem(data, 'x52009230'), 'x00209113'),
          'x00200032',
          '0\\0'
        );
      } else {
        overwriteDicomString(
          firstItem(firstItem(data, 'x52009229'), 'x00209116'),
          'x00200037',
          kind === 'orientation' ? '1\\0\\0\\0\\1' : '2\\0\\0\\0\\.5\\0'
        );
      }
      const metadata: Array<[string, string]> = [
        ...baseMetadata(),
        [Tags.Rows, '2'],
        [Tags.Columns, '2'],
        [Tags.NumberOfFrames, '2'],
        [Tags.BitsStored, '16'],
        [Tags.PixelRepresentation, '0'],
        [Tags.ImagePositionPatient, '9\\8\\7'],
        [Tags.ImageOrientationPatient, '1\\0\\0\\0\\1\\0'],
      ];
      const tags = new Map(
        await augmentOCTMetadata(new Blob([bytes]), metadata)
      );
      expect(spatialMetadataError(tags)).toBeTruthy();
      const image = allocateImageFromChunks([{ metadata: [...tags] } as Chunk]);
      expect(image.getOrigin()).toEqual([9, 8, 7]);
      expect(image.getDirection()).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
      image.delete();
    }
  );
  it.each([false, true])(
    'rejects nonuniform B-scan positions with deflate=%s',
    async (deflated) => {
      const bytes = fixtureBytes();
      const data = readDataset(bytes);
      const finalFrame = data.elements.x52009230.items!.at(-1)!.dataSet!;
      const position = firstItem(finalFrame, 'x00209113');
      overwriteDicomString(position, 'x00200032', '0.0\\0.0\\5.8225');
      expect(
        spatialMetadataError(
          await augmented(deflated ? deflatedExplicitVR(bytes) : bytes)
        )
      ).toMatch(/nonuniform/);
    }
  );

  it('rejects tilted scan positions that leave the Cartesian voxel grid', async () => {
    const bytes = fixtureBytes();
    const data = readDataset(bytes);
    const secondFrame = data.elements.x52009230.items![1].dataSet!;
    overwriteDicomString(
      firstItem(secondFrame, 'x00209113'),
      'x00200032',
      '1.0\\0.0\\0.1875'
    );
    expect(spatialMetadataError(await augmented(bytes))).toMatch(
      /image grid|nonuniform positions/
    );
  });

  it('derives inter-frame spacing from uniform positions', async () => {
    const tags = await augmentOCTMetadata(
      enhancedFile([
        { position: '0\\0\\0' },
        { position: '0\\0\\0.2' },
        { position: '0\\0\\0.4' },
      ]),
      baseMetadata()
    );
    expect(spatialMetadataError(tags)).toBeUndefined();
    expect(new Map(tags).get(Tags.SpacingBetweenSlices)).toBe('0.2');
  });

  it('accepts positions rounded to four decimal places', async () => {
    const tags = await augmentOCTMetadata(
      enhancedFile(
        Array.from({ length: 49 }, (_, i) => ({
          position: `0\\0\\${(i * 0.12306585).toFixed(4)}`,
        }))
      ),
      baseMetadata()
    );
    expect(spatialMetadataError(tags)).toBeUndefined();
  });

  it('accepts rounded orthogonal direction cosines', async () => {
    const bytes = fixtureBytes();
    overwriteDicomString(
      firstItem(firstItem(readDataset(bytes), 'x52009229'), 'x00209116'),
      'x00200037',
      '.8660\\.5\\0\\-.5\\.8660\\0'
    );
    expect(spatialMetadataError(await augmented(bytes))).toBeUndefined();
  });

  it('promotes oblique geometry rounded to four decimal places', async () => {
    const orientation = '0.0361\\-0.5727\\0.819\\0.2369\\0.801\\0.5498';
    const normal = [-0.97088946, 0.17417332, 0.16458873];
    const position = normal.map((n) => (n * 0.2).toFixed(4)).join('\\');
    const tags = new Map(
      await augmentOCTMetadata(
        enhancedFile(
          [{ position: '0\\0\\0' }, { position }],
          [],
          [sequence('00209116', [element('00200037', 'DS', orientation)])]
        ),
        baseMetadata()
      )
    );
    expect(spatialMetadataError(tags)).toBeUndefined();
    expect(tags.get(Tags.ImageOrientationPatient)).toBe(orientation);
    expect(tags.get(Tags.ImagePositionPatient)).toBe('0\\0\\0');
    expect(Number(tags.get(Tags.SpacingBetweenSlices))).toBeCloseTo(0.2, 4);
  });

  it.each(['frame', 'top level'])(
    'uses %s orientation when the shared value is blank',
    async (fallback) => {
      const orientation = '1\\0\\0\\0\\1\\0';
      const bytes = new Uint8Array(
        await enhancedFile(
          [
            {
              position: '0\\0\\0',
              ...(fallback === 'frame' ? { orientation } : {}),
            },
            { position: '0\\0\\0.2' },
          ],
          fallback === 'top level'
            ? [element('00200037', 'DS', orientation)]
            : []
        ).arrayBuffer()
      );
      overwriteDicomString(
        firstItem(firstItem(readDataset(bytes), 'x52009229'), 'x00209116'),
        'x00200037',
        '  '
      );
      const tags = await augmented(bytes);
      expect(spatialMetadataError(tags)).toBeUndefined();
      expect(tags.get(Tags.ImageOrientationPatient)).toBe(orientation);
      expect(tags.get(Tags.ImagePositionPatient)).toBe('0\\0\\0');
      expect(tags.get(Tags.SpacingBetweenSlices)).toBe('0.2');
    }
  );

  it('does not promote geometry for frames stored against the positive normal', async () => {
    const tags = new Map(
      await augmentOCTMetadata(
        enhancedFile([
          { position: '0\\0\\0.4' },
          { position: '0\\0\\0.2' },
          { position: '0\\0\\0' },
        ]),
        baseMetadata()
      )
    );
    expect(spatialMetadataError(tags)).toMatch(/image grid/);
    expect(tags.has(Tags.ImagePositionPatient)).toBe(false);
    expect(tags.has(Tags.ImageOrientationPatient)).toBe(false);
    expect(tags.has(Tags.SpacingBetweenSlices)).toBe(false);
  });

  it.each([undefined, '0'])(
    'marks unpositioned multiframe OCT with slice spacing %s unavailable',
    async (spacing) => {
      const file = enhancedFile(
        [{}, {}, {}],
        spacing === undefined ? [] : [element('00180088', 'DS', spacing)]
      );
      const tags = new Map(await augmentOCTMetadata(file, baseMetadata()));
      expect(spatialMetadataError(tags)).toMatch(/slice spacing.*unavailable/);
      expect(tags.get(Tags.PixelSpacing)).toBe('0.01\\0.02');
    }
  );

  it('requires orientation before deriving spacing from positioned frames', async () => {
    const bytes = new Uint8Array(
      await enhancedFile([
        { position: '0\\0\\0' },
        { position: '0.2\\0\\0' },
      ]).arrayBuffer()
    );
    const shared = firstItem(readDataset(bytes), 'x52009229');
    hide(firstItem(shared, 'x00209116'), 'x00200037');
    const tags = await augmented(bytes);
    expect(spatialMetadataError(tags)).toMatch(/orientation.*missing/);
    expect(tags.has(Tags.SpacingBetweenSlices)).toBe(false);
  });

  it('preserves unpositioned frames without patient orientation', async () => {
    const bytes = new Uint8Array(
      await enhancedFile(
        [{}, {}],
        [element('00180088', 'DS', '0.2')]
      ).arrayBuffer()
    );
    const shared = firstItem(readDataset(bytes), 'x52009229');
    hide(firstItem(shared, 'x00209116'), 'x00200037');
    const tags = await augmented(bytes);
    expect(spatialMetadataError(tags)).toBeUndefined();
    expect(tags.get(Tags.SpacingBetweenSlices)).toBe('0.2');
  });

  it.each([
    [
      'frames with inconsistent pixel spacing',
      [
        { position: '0\\0\\0' },
        { position: '0\\0\\0.2', spacing: '0.02\\0.02' },
      ],
      /different pixel spacing/,
    ],
    [
      'unequal per-frame slice spacing without positions',
      [{ slowSpacing: '0.2' }, { slowSpacing: '0.3' }],
      /slice spacing/,
    ],
    [
      'nonparallel frames',
      [
        { position: '0\\0\\0' },
        { position: '0\\0\\0.2', orientation: '0\\1\\0\\1\\0\\0' },
      ],
      /not parallel/,
    ],
    [
      'a frame missing its position',
      [{ position: '0\\0\\0' }, {}],
      /incomplete/,
    ],
    [
      'a frame missing its position after a positioned pair',
      [{ position: '0\\0\\0' }, { position: '0\\0\\0.2' }, {}],
      /incomplete/,
    ],
    [
      'repeated B-scans rather than stacking duplicate locations',
      [{ position: '0\\0\\0' }, { position: '0\\0\\0' }],
      /Repeated/,
    ],
  ])('rejects %s', async (_label, frames, error) => {
    const tags = await augmentOCTMetadata(enhancedFile(frames), baseMetadata());
    expect(spatialMetadataError(tags)).toMatch(error);
  });

  it('records unreadable spatial metadata when the OCT header cannot be parsed', async () => {
    const tags = await augmentOCTMetadata(
      new Blob(['corrupt OCT']),
      baseMetadata()
    );
    expect(spatialMetadataError(tags)).toBe(
      'OCT spatial metadata could not be read.'
    );
  });
});
