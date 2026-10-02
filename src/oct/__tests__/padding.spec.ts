import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dicomParser from 'dicom-parser';
import { readImageNode } from '@itk-wasm/image-io';
import { buildSyntheticDicom } from '@/tests/specs/syntheticDicom';
import { augmentOCTMetadata } from '@/src/oct/dicomMetadata';
import { Tags } from '@/src/core/dicomTags';
import { OCT_PADDING_ERROR, octPadding } from '@/src/oct/padding';

function metadata(overrides: Record<string, string> = {}) {
  return Object.entries({
    [Tags.PixelRepresentation]: '0',
    [Tags.BitsStored]: '16',
    [Tags.PixelPaddingValue]: '65535',
    ...overrides,
  });
}

async function decodePaddingFile(
  settings: {
    value: number;
    signed: boolean;
    slope: number;
    intercept: number;
  },
  neighbor?: number
) {
  const original = buildSyntheticDicom({
    studyUid: '1.2.3.1',
    seriesUid: '1.2.3.2',
    sopUid: '1.2.3.3',
    instanceNumber: 1,
    modality: 'OPT',
    imageOrientationPatient: [1, 0, 0, 0, 1, 0],
    imagePositionPatient: [0, 0, 0],
    pixelValue: settings.value,
    pixelRepresentation: Number(settings.signed),
    rescaleSlope: settings.slope,
    rescaleIntercept: settings.intercept,
  });
  const source = dicomParser.parseDicom(original);
  if (neighbor !== undefined)
    new DataView(original.buffer).setUint16(
      source.elements.x7fe00010.dataOffset + 2,
      neighbor,
      true
    );
  const padding = new Uint8Array(10);
  const view = new DataView(padding.buffer);
  view.setUint16(0, 0x0028, true);
  view.setUint16(2, 0x0120, true);
  padding.set(new TextEncoder().encode(settings.signed ? 'SS' : 'US'), 4);
  view.setUint16(6, 2, true);
  if (settings.signed) view.setInt16(8, settings.value, true);
  else view.setUint16(8, settings.value, true);
  const insertion = source.elements.x7fe00010.dataOffset - 12;
  const bytes = new Uint8Array(original.length + padding.length);
  bytes.set(original.subarray(0, insertion));
  bytes.set(padding, insertion);
  bytes.set(original.subarray(insertion), insertion + padding.length);
  const directory = mkdtempSync(join(tmpdir(), 'oct-padding-decoder-'));
  const path = join(directory, 'padding.dcm');
  try {
    writeFileSync(path, bytes);
    const image = await readImageNode(path);
    const tags = await augmentOCTMetadata(
      new Blob([bytes]),
      metadata({
        [Tags.Modality]: 'OPT',
        [Tags.PixelRepresentation]: String(Number(settings.signed)),
        [Tags.RescaleSlope]: String(settings.slope),
        [Tags.RescaleIntercept]: String(settings.intercept),
      })
    );
    return { image, tags };
  } finally {
    unlinkSync(path);
    rmdirSync(directory);
  }
}

describe('declared OCT padding in decoded scalar units', () => {
  it('maps a single-file declaration to every native frame', () => {
    expect(octPadding([metadata()], 32)).toEqual({
      ranges: [{ firstFrame: 0, lastFrame: 31, min: 65535, max: 65535 }],
      reason: null,
    });
  });
  it('does not invent a padding declaration for unmarked zeros', () => {
    expect(octPadding([[[Tags.BitsStored, '16']]], 32)).toEqual({
      ranges: [],
      reason: null,
    });
  });
  it('accepts inclusive signed ranges and reorders negative-slope decoded bounds', () => {
    expect(
      octPadding(
        [
          metadata({
            [Tags.PixelRepresentation]: '1',
            [Tags.PixelPaddingValue]: '-32768',
            [Tags.PixelPaddingRangeLimit]: '-32766',
            [Tags.RescaleSlope]: '-0.5',
            [Tags.RescaleIntercept]: '10.25',
          }),
        ],
        2
      )
    ).toEqual({
      ranges: [{ firstFrame: 0, lastFrame: 1, min: 16393.25, max: 16394.25 }],
      reason: null,
    });
  });
  it('keeps per-file transformations isolated and merges only equal consecutive decoded padding', () => {
    const plain = metadata();
    const scaled = metadata({
      [Tags.RescaleSlope]: '0.25',
      [Tags.RescaleIntercept]: '-1',
    });
    const result = octPadding([plain, plain, [], scaled, scaled], 5);
    expect(result.reason).toBeNull();
    expect(result.ranges).toEqual([
      { firstFrame: 0, lastFrame: 1, min: 65535, max: 65535 },
      { firstFrame: 3, lastFrame: 4, min: 16382.75, max: 16382.75 },
    ]);
  });
  it.each([
    { [Tags.PixelPaddingValue]: '' },
    { [Tags.PixelPaddingValue]: '0.5' },
    { [Tags.PixelPaddingValue]: '-1' },
    { [Tags.PixelPaddingValue]: '65536' },
    { [Tags.PixelRepresentation]: '2' },
    { [Tags.BitsStored]: '0' },
    { [Tags.BitsStored]: '33' },
    { [Tags.RescaleSlope]: '0' },
    { [Tags.RescaleSlope]: '' },
    { [Tags.RescaleIntercept]: 'NaN' },
    { [Tags.RescaleSlope]: '1e308' },
  ])('disables ambiguous or invalid declaration %#', (overrides) => {
    const result = octPadding([metadata(overrides)], 1);
    expect(result.ranges).toEqual([]);
    expect(result.reason).toMatch(/cannot be interpreted/);
  });
  it.each([0, 65535])(
    'checks the remaining non-padding neighbor at a stored-domain limit: %s',
    (value) => {
      const result = octPadding(
        [
          metadata({
            [Tags.PixelPaddingValue]: String(value),
            [Tags.RescaleIntercept]: '1e20',
          }),
        ],
        1
      );
      expect(result.reason).toMatch(/cannot be interpreted/);
    }
  );

  it('rejects a negative transform whose adjacent valid value collapses into padding', () => {
    const result = octPadding(
      [
        metadata({
          [Tags.PixelPaddingValue]: '1',
          [Tags.RescaleSlope]: '-1',
          [Tags.RescaleIntercept]: '-1e20',
        }),
      ],
      1
    );
    expect(result.reason).toMatch(/cannot be interpreted/);
  });

  it('permits a declared interval covering the complete stored domain', () => {
    const result = octPadding(
      [
        metadata({
          [Tags.PixelPaddingValue]: '0',
          [Tags.PixelPaddingRangeLimit]: '65535',
          [Tags.RescaleIntercept]: '1e20',
        }),
      ],
      1
    );
    expect(result).toEqual({
      ranges: [{ firstFrame: 0, lastFrame: 0, min: 1e20, max: 1e20 + 65535 }],
      reason: null,
    });
  });

  it('rejects a range limit without a padding value', () => {
    expect(
      octPadding(
        [
          Object.entries({
            [Tags.PixelRepresentation]: '0',
            [Tags.BitsStored]: '16',
            [Tags.PixelPaddingRangeLimit]: '65535',
          }),
        ],
        1
      ).reason
    ).toMatch(/cannot be interpreted/);
  });
  it('rejects an unsupported transformation even if the text reader omitted the corrupt binary declaration', () => {
    expect(
      octPadding([[[OCT_PADDING_ERROR, 'Unsupported OCT transformation.']]], 1)
    ).toEqual({
      ranges: [],
      reason: 'Unsupported OCT transformation.',
    });
  });
  it('rejects an ambiguous file-to-frame mapping', () => {
    expect(octPadding([metadata(), metadata()], 4).reason).toMatch(
      /cannot be interpreted/
    );
  });
});

describe('padding rescale precision with the actual ITK DICOM decoder', () => {
  it.each([
    { value: 1, signed: false, slope: 0.1, intercept: 0 },
    { value: -32768, signed: true, slope: -0.1, intercept: 0.25 },
    { value: 65535, signed: false, slope: 0.25, intercept: -1 },
  ])('matches decoded stored padding exactly: %j', async (settings) => {
    const { image, tags } = await decodePaddingFile(settings);
    const result = octPadding([tags], 1);
    expect(result.reason).toBeNull();
    const expected = settings.value * settings.slope + settings.intercept;
    expect(result.ranges).toEqual([
      { firstFrame: 0, lastFrame: 0, min: expected, max: expected },
    ]);
    // The installed decoder uses doubles for fractional rescale, so equality
    // excludes precisely the declared padding without swallowing nearby pixels.
    expect(image.data).toBeInstanceOf(Float64Array);
    expect(Array.from(image.data as Float64Array)).toEqual(
      Array(16).fill(expected)
    );
  });

  it('rejects a transform that merges padding and valid stored pixels in the actual decoder', async () => {
    const { image, tags } = await decodePaddingFile(
      { value: 1, signed: false, slope: 1, intercept: 1e20 },
      2
    );
    expect(image.data).toBeInstanceOf(Float64Array);
    expect((image.data as Float64Array)[0]).toBe(1e20);
    expect((image.data as Float64Array)[1]).toBe(1e20);
    expect(octPadding([tags], 1)).toEqual({
      ranges: [],
      reason: expect.stringMatching(/cannot be interpreted/),
    });
  });
});
