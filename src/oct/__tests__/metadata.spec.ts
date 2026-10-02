import { readFileSync } from 'node:fs';
import { URL as FileURL } from 'node:url';
import dicomParser, { type DataSet } from 'dicom-parser';
import { describe, expect, it } from 'vitest';
import { Tags } from '@/src/core/dicomTags';
import { augmentOCTMetadata } from '@/src/oct/dicomMetadata';
import { octPadding, OCT_PADDING_ERROR } from '@/src/oct/padding';
import {
  isOCTMetadata,
  octCalibratedAxes,
  octGeometryReason,
  OCT_GEOMETRY_ERROR,
  OCT_SCAN_PATTERN,
  OPHTHALMIC_TOMOGRAPHY_SOP,
  OPHTHALMIC_BSCAN_ANALYSIS_SOP,
  OPHTHALMIC_EN_FACE_SOP,
} from '@/src/oct/detection';

const fixtureURL = new FileURL(
  '../../../tests/fixtures/oct/retina-derived.dcm',
  import.meta.url
);
const reference = JSON.parse(
  readFileSync(
    new FileURL('../../../tests/fixtures/oct/reference.json', import.meta.url),
    'utf8'
  )
);

const baseMetadata = (): Array<[string, string]> => [
  [Tags.SOPClassUID, OPHTHALMIC_TOMOGRAPHY_SOP],
  [Tags.Modality, 'OPT'],
];

const firstItem = (data: DataSet, tag: string) =>
  data.elements[tag].items![0].dataSet!;

function fixtureBytes() {
  return new Uint8Array(readFileSync(fixtureURL));
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

function concat(chunks: Uint8Array[]) {
  const output = new Uint8Array(
    chunks.reduce((length, bytes) => length + bytes.length, 0)
  );
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function element(tag: string, vr: string, value: string | Uint8Array) {
  let payload =
    typeof value === 'string' ? new TextEncoder().encode(value) : value;
  if (payload.length % 2)
    payload = concat([payload, new Uint8Array([vr === 'UI' ? 0 : 0x20])]);
  const header = new Uint8Array(vr === 'SQ' ? 12 : 8);
  const view = new DataView(header.buffer);
  view.setUint16(0, parseInt(tag.slice(0, 4), 16), true);
  view.setUint16(2, parseInt(tag.slice(4), 16), true);
  header.set(new TextEncoder().encode(vr), 4);
  if (vr === 'SQ') view.setUint32(8, payload.length, true);
  else view.setUint16(6, payload.length, true);
  return concat([header, payload]);
}

function sequence(tag: string, datasets: Uint8Array[]) {
  return element(
    tag,
    'SQ',
    concat(
      datasets.map((dataset) => {
        const header = new Uint8Array(8);
        const view = new DataView(header.buffer);
        view.setUint16(0, 0xfffe, true);
        view.setUint16(2, 0xe000, true);
        view.setUint32(4, dataset.length, true);
        return concat([header, dataset]);
      })
    )
  );
}

function enhancedFile(
  frames: { position?: string; spacing?: string; orientation?: string }[],
  extraHeader: Uint8Array[] = [],
  extraShared: Uint8Array[] = []
) {
  const positionSequence = (position: string) =>
    sequence('00209113', [element('00200032', 'DS', position)]);
  const measureSequence = (spacing: string) =>
    sequence('00289110', [element('00280030', 'DS', spacing)]);
  const orientationSequence = (orientation: string) =>
    sequence('00209116', [element('00200037', 'DS', orientation)]);
  const bytes = concat([
    new Uint8Array(128),
    new TextEncoder().encode('DICM'),
    element('00020010', 'UI', '1.2.840.10008.1.2.1'),
    element('00080016', 'UI', OPHTHALMIC_TOMOGRAPHY_SOP),
    element('00280008', 'IS', String(frames.length)),
    ...extraHeader,
    sequence('52009229', [
      concat([
        measureSequence('0.01\\0.02'),
        orientationSequence('1\\0\\0\\0\\1\\0'),
        ...extraShared,
      ]),
    ]),
    sequence(
      '52009230',
      frames.map((frame) =>
        concat([
          ...(frame.position ? [positionSequence(frame.position)] : []),
          ...(frame.spacing ? [measureSequence(frame.spacing)] : []),
          ...(frame.orientation
            ? [orientationSequence(frame.orientation)]
            : []),
        ])
      )
    ),
  ]);
  return new Blob([bytes]);
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

  it('does not activate a volume projection for an existing en face image', () => {
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
  it('reads the public real-pixel fixture and promotes nested geometry', async () => {
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
    expect(octCalibratedAxes(tags)).toEqual([true, true, true]);
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

  it('allows intensity projection without invented physical calibration', async () => {
    const bytes = fixtureBytes();
    const data = readDataset(bytes);
    const shared = firstItem(data, 'x52009229');
    const measures = firstItem(shared, 'x00289110');
    hide(data, 'x00280030');
    hide(measures, 'x00280030');
    const tags = await augmented(bytes);
    expect(isOCTMetadata(tags)).toBe(true);
    expect(octGeometryReason(tags)).toBeNull();
    expect(octCalibratedAxes(tags)).toEqual([false, false, true]);
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
  it('rejects nonuniform B-scan positions in the public fixture', async () => {
    const bytes = fixtureBytes();
    const data = readDataset(bytes);
    const finalFrame = data.elements.x52009230.items!.at(-1)!.dataSet!;
    const position = firstItem(finalFrame, 'x00209113');
    overwrite(position, 'x00200032', '0.0\\0.0\\5.8225');
    expect(octGeometryReason(await augmented(bytes))).toMatch(/nonuniform/);
  });

  it('rejects tilted scan positions that leave the Cartesian voxel grid', async () => {
    const bytes = fixtureBytes();
    const data = readDataset(bytes);
    const secondFrame = data.elements.x52009230.items![1].dataSet!;
    overwrite(
      firstItem(secondFrame, 'x00209113'),
      'x00200032',
      '1.0\\0.0\\0.1875'
    );
    expect(octGeometryReason(await augmented(bytes))).toMatch(/image grid/);
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
    expect(octCalibratedAxes(tags)).toEqual([true, true, true]);
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

  it('calibrates axes only from finite positive declared spacing', () => {
    expect(octCalibratedAxes(baseMetadata())).toEqual([false, false, false]);
    expect(
      octCalibratedAxes([
        [Tags.PixelSpacing, '0.01\\NaN'],
        [Tags.SpacingBetweenSlices, '-2'],
      ])
    ).toEqual([false, true, false]);
    expect(
      octCalibratedAxes([
        [Tags.PixelSpacing, 'Infinity\\0'],
        [Tags.SpacingBetweenSlices, '0'],
      ])
    ).toEqual([false, false, false]);
  });
});

function paddingElement(tag: string, value: number, signed = false) {
  const bytes = new Uint8Array(2);
  const view = new DataView(bytes.buffer);
  if (signed) view.setInt16(0, value, true);
  else view.setUint16(0, value, true);
  return element(tag, signed ? 'SS' : 'US', bytes);
}

describe('OCT padding metadata from actual binary DICOM attributes', () => {
  const frames = [{ position: '0\\0\\0' }, { position: '0\\0\\0.2' }];
  function declarations(signed = false) {
    return [
      ...baseMetadata(),
      [Tags.BitsStored, '16'],
      [Tags.PixelRepresentation, signed ? '1' : '0'],
    ] as Array<[string, string]>;
  }

  it.each([false, true])(
    'reads unsigned or signed padding and inclusive range: signed=%s',
    async (signed) => {
      const first = signed ? -32768 : 65533;
      const last = signed ? -32766 : 65535;
      const file = enhancedFile(frames, [
        paddingElement('00280103', Number(signed)),
        paddingElement('00280120', first, signed),
        paddingElement('00280121', last, signed),
      ]);
      const tags = await augmentOCTMetadata(file, declarations(signed));
      expect(new Map(tags).get(Tags.PixelPaddingValue)).toBe(String(first));
      expect(new Map(tags).get(Tags.PixelPaddingRangeLimit)).toBe(String(last));
      expect(octPadding([tags], 2)).toEqual({
        ranges: [{ firstFrame: 0, lastFrame: 1, min: first, max: last }],
        reason: null,
      });
    }
  );

  it('rejects a padding VR that disagrees with signed pixel representation', async () => {
    const tags = await augmentOCTMetadata(
      enhancedFile(frames, [
        paddingElement('00280103', 1),
        paddingElement('00280120', 65535),
      ]),
      declarations(true)
    );
    expect(new Map(tags).get(OCT_PADDING_ERROR)).toMatch(
      /cannot be interpreted/
    );
    expect(octPadding([tags], 2).reason).toMatch(/cannot be interpreted/);
  });

  it('rejects a shared pixel-value transformation whose decoder mapping is not established', async () => {
    const transform = sequence('00289145', [element('00281053', 'DS', '0.25')]);
    const tags = await augmentOCTMetadata(
      enhancedFile(
        frames,
        [paddingElement('00280103', 0), paddingElement('00280120', 65535)],
        [transform]
      ),
      declarations()
    );
    expect(octPadding([tags], 2).reason).toMatch(
      /unsupported modality transformation/
    );
  });

  it('rejects an unknown modality LUT when declared padding requires an exact mapping', async () => {
    const tags = await augmentOCTMetadata(
      enhancedFile(frames, [
        paddingElement('00280103', 0),
        paddingElement('00280120', 65535),
        sequence('00283000', []),
      ]),
      declarations()
    );
    expect(octPadding([tags], 2).reason).toMatch(
      /unsupported modality transformation/
    );
  });
});
