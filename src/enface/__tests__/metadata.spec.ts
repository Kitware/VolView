import dicomParser, { type DataSet } from 'dicom-parser';
import { deflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Tags } from '@/src/core/dicomTags';
import { augmentOCTMetadata } from '@/src/enface/dicomMetadata';

import { deflatedExplicitVR } from '@/tests/fixtures/oct/volumes';
import {
  isOCTMetadata,
  octGeometryReason,
  OCT_GEOMETRY_ERROR,
  OCT_SCAN_PATTERN,
  OPHTHALMIC_TOMOGRAPHY_SOP,
  OPHTHALMIC_BSCAN_ANALYSIS_SOP,
  OPHTHALMIC_EN_FACE_SOP,
} from '@/src/enface/detection';

import reference from '@/tests/fixtures/oct/reference.json';
import {
  createSyntheticOCT,
  element,
  enhancedFile,
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

function overwrite(data: DataSet, tag: string, value: string) {
  const attribute = data.elements[tag];
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > attribute.length)
    throw new Error('Test replacement exceeds DICOM value length');
  data.byteArray.fill(
    0x20,
    attribute.dataOffset,
    attribute.dataOffset + attribute.length
  );
  data.byteArray.set(bytes, attribute.dataOffset);
}

function hide(data: DataSet, tag: string) {
  const attribute = data.elements[tag];
  // Explicit-VR DS headers are 8 bytes. Rename to an unused private group.
  const start = attribute.dataOffset - 8;
  data.byteArray[start] = 0x77;
  data.byteArray[start + 1] = 0x77;
}

async function augmented(bytes = fixtureBytes()) {
  return new Map(
    await augmentOCTMetadata(new Blob([bytes as BlobPart]), baseMetadata())
  );
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
    const reads: number[] = [];
    const arrayBuffer = Blob.prototype.arrayBuffer;
    vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementation(function (
      this: Blob
    ) {
      reads.push(this.size);
      return arrayBuffer.call(this);
    });

    expect(await augmented(source)).toEqual(expected);
    expect(reads.reduce((total, bytes) => total + bytes, 0)).toBeLessThan(
      source.length / 10
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

  it('disables projection when the deflated dataset is truncated', async () => {
    const bytes = deflatedExplicitVR(fixtureBytes());
    expect(octGeometryReason(await augmented(bytes.subarray(0, -10)))).toMatch(
      /could not be read|unavailable/
    );
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
    expect(octGeometryReason(tags)).toBeNull();
  });

  it('blocks unsupported scan patterns such as radial scans', async () => {
    const bytes = fixtureBytes();
    const data = readDataset(bytes);
    overwrite(firstItem(data, 'x00221618'), 'x00080100', '128282');
    const tags = await augmented(bytes);
    expect(isOCTMetadata(tags)).toBe(true);
    expect(octGeometryReason(tags)).toMatch(/scan pattern.*reconstruction/);
  });

  it('blocks volumes explicitly marked unsuitable for volumetric processing', async () => {
    const bytes = fixtureBytes();
    overwrite(readDataset(bytes), 'x00221622', 'NO');
    expect(octGeometryReason(await augmented(bytes))).toMatch(/unsuitable/);
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
    expect(octGeometryReason(tags)).toBeNull();
    expect(tags.has(Tags.PixelSpacing)).toBe(false);
  });

  it('rejects a per-frame geometry count that disagrees with NumberOfFrames', async () => {
    const bytes = fixtureBytes();
    overwrite(readDataset(bytes), 'x00280008', '31');
    expect(octGeometryReason(await augmented(bytes))).toMatch(
      /frame.*count|number.*frames/i
    );
  });

  it.each([
    [2, 0, 0, 0, 0.5, 0],
    [1, 0, 0, 0.5, 1, 0],
  ])(
    'rejects direction cosines that would distort physical thickness %#',
    async (...orientation) => {
      const bytes = fixtureBytes();
      const data = readDataset(bytes);
      const shared = firstItem(data, 'x52009229');
      overwrite(
        firstItem(shared, 'x00209116'),
        'x00200037',
        orientation.join('\\')
      );
      expect(octGeometryReason(await augmented(bytes))).toMatch(
        /orientation|orthonormal|direction/i
      );
    }
  );
  it.each([false, true])(
    'rejects nonuniform B-scan positions with deflate=%s',
    async (deflated) => {
      const bytes = fixtureBytes();
      const data = readDataset(bytes);
      const finalFrame = data.elements.x52009230.items!.at(-1)!.dataSet!;
      const position = firstItem(finalFrame, 'x00209113');
      overwrite(position, 'x00200032', '0.0\\0.0\\5.8225');
      expect(
        octGeometryReason(
          await augmented(deflated ? deflatedExplicitVR(bytes) : bytes)
        )
      ).toMatch(/nonuniform/);
    }
  );

  it('rejects tilted scan positions that leave the Cartesian voxel grid', async () => {
    const bytes = fixtureBytes();
    const data = readDataset(bytes);
    const secondFrame = data.elements.x52009230.items![1].dataSet!;
    overwrite(
      firstItem(secondFrame, 'x00209113'),
      'x00200032',
      '1.0\\0.0\\0.1875'
    );
    expect(octGeometryReason(await augmented(bytes))).toMatch(
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
    expect(octGeometryReason(tags)).toBeNull();
    expect(new Map(tags).get(Tags.SpacingBetweenSlices)).toBe('0.2');
  });

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
    expect(octGeometryReason(tags)).toMatch(/orientation.*missing/);
    expect(tags.has(Tags.SpacingBetweenSlices)).toBe(false);
  });

  it('preserves unpositioned projection without patient orientation', async () => {
    const bytes = new Uint8Array(
      await enhancedFile(
        [{}, {}],
        [element('00180088', 'DS', '0.2')]
      ).arrayBuffer()
    );
    const shared = firstItem(readDataset(bytes), 'x52009229');
    hide(firstItem(shared, 'x00209116'), 'x00200037');
    const tags = await augmented(bytes);
    expect(octGeometryReason(tags)).toBeNull();
    expect(tags.get(Tags.SpacingBetweenSlices)).toBe('0.2');
  });

  it('rejects frames with inconsistent pixel spacing', async () => {
    const tags = await augmentOCTMetadata(
      enhancedFile([
        { position: '0\\0\\0' },
        { position: '0\\0\\0.2', spacing: '0.02\\0.02' },
      ]),
      baseMetadata()
    );
    expect(octGeometryReason(tags)).toMatch(/different pixel spacing/);
  });

  it('rejects unequal per-frame slice spacing without positions', async () => {
    const tags = await augmentOCTMetadata(
      enhancedFile([{ slowSpacing: '0.2' }, { slowSpacing: '0.3' }]),
      baseMetadata()
    );
    expect(octGeometryReason(tags)).toMatch(/slice spacing/);
  });

  it('rejects nonparallel frames', async () => {
    const tags = await augmentOCTMetadata(
      enhancedFile([
        { position: '0\\0\\0' },
        { position: '0\\0\\0.2', orientation: '0\\1\\0\\1\\0\\0' },
      ]),
      baseMetadata()
    );
    expect(octGeometryReason(tags)).toMatch(/not parallel/);
  });

  it.each([
    [{ position: '0\\0\\0' }, {}],
    [{ position: '0\\0\\0' }, { position: '0\\0\\0.2' }, {}],
  ])('rejects partially missing frame positions %#', async (...frames) => {
    const tags = await augmentOCTMetadata(enhancedFile(frames), baseMetadata());
    expect(octGeometryReason(tags)).toMatch(/incomplete/);
  });

  it('rejects repeated B-scans rather than stacking duplicate locations', async () => {
    const tags = await augmentOCTMetadata(
      enhancedFile([{ position: '0\\0\\0' }, { position: '0\\0\\0' }]),
      baseMetadata()
    );
    expect(octGeometryReason(tags)).toMatch(/Repeated/);
  });

  it('disables projection when OCT spatial metadata cannot be parsed', async () => {
    const tags = await augmentOCTMetadata(
      new Blob(['corrupt OCT']),
      baseMetadata()
    );
    expect(new Map(tags).get(OCT_GEOMETRY_ERROR)).toMatch(/could not be read/);
    expect(octGeometryReason(tags)).toMatch(/unavailable/);
  });
});
