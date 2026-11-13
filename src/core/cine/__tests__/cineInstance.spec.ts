import { describe, expect, it } from 'vitest';
import {
  fromBlob,
  readInstance,
  SOP_CLASS_ULTRASOUND_MULTIFRAME_RETIRED,
  Tags,
} from '@/packages/dicom/core';
import {
  buildSyntheticCineDicom,
  rawElement,
  sequenceItem,
  type SyntheticCineOptions,
} from '@/tests/specs/syntheticDicom';
import {
  isCineInstance,
  readCineFrames,
  readCineHeader,
} from '../cineInstance';
import {
  cineInstance,
  TS_EXPLICIT_VR_LE,
  TS_JPEG_BASELINE,
} from './cineFixtures';

const TS_JPEG_EXTENDED = '1.2.840.10008.1.2.4.51';
const TS_RLE = '1.2.840.10008.1.2.5';

const PHOTOMETRICS = [
  'MONOCHROME1',
  'MONOCHROME2',
  'PALETTE COLOR',
  'RGB',
  'YBR_FULL',
  'YBR_FULL_422',
];

const accepted = (tags: Record<string, string>, transferSyntaxUid?: string) =>
  isCineInstance(cineInstance(tags, { transferSyntaxUid }));

describe('isCineInstance', () => {
  it('accepts current and retired ultrasound multi-frame SOP classes', () => {
    expect(accepted({})).toBe(true);
    expect(
      accepted({ [Tags.SOPClassUID]: SOP_CLASS_ULTRASOUND_MULTIFRAME_RETIRED })
    ).toBe(true);
  });

  it('rejects other SOP classes and single frames', () => {
    expect(accepted({ [Tags.SOPClassUID]: '1.2.840.10008.5.1.4.1.1.2' })).toBe(
      false
    );
    expect(accepted({ [Tags.NumberOfFrames]: '1' })).toBe(false);
  });

  it('accepts only MONOCHROME2 for native one-sample pixels', () => {
    expect(
      PHOTOMETRICS.filter((photometric) =>
        accepted({ [Tags.PhotometricInterpretation]: photometric })
      )
    ).toEqual(['MONOCHROME2']);
  });

  it('accepts only RGB for native three-sample pixels', () => {
    expect(
      PHOTOMETRICS.filter((photometric) =>
        accepted({
          [Tags.SamplesPerPixel]: '3',
          [Tags.PhotometricInterpretation]: photometric,
        })
      )
    ).toEqual(['RGB']);
  });

  it('rejects native pixels unless Bits Allocated is 8, reading an empty value as 8', () => {
    expect(accepted({ [Tags.BitsAllocated]: '16' })).toBe(false);
    expect(accepted({ [Tags.BitsAllocated]: '' })).toBe(true);
  });

  it('accepts JPEG Baseline whatever its pixel format and no other compression', () => {
    const anyFormat = {
      [Tags.BitsAllocated]: '16',
      [Tags.SamplesPerPixel]: '3',
      [Tags.PhotometricInterpretation]: 'YBR_FULL_422',
    };
    expect(accepted(anyFormat, TS_JPEG_BASELINE)).toBe(true);
    expect(accepted(anyFormat, TS_JPEG_EXTENDED)).toBe(false);
    expect(accepted({}, TS_RLE)).toBe(false);
  });

  it('rejects a header without a Part 10 preamble or without Pixel Data', () => {
    const clip = cineInstance();
    expect(
      isCineInstance({ ...clip, layout: { preamble: false, fileMeta: true } })
    ).toBe(false);
    expect(isCineInstance({ ...clip, pixelData: null })).toBe(false);
  });
});

const signal = () => new AbortController().signal;

const readClip = (options: Partial<SyntheticCineOptions>) => {
  const bytes = buildSyntheticCineDicom({
    studyUid: '1.2.3',
    seriesUid: '1.2.3.4',
    sopUid: '1.2.3.4.5',
    ...options,
  });
  return readInstance(fromBlob(new Blob([bytes as BlobPart])), signal());
};

const binary = (write: (view: DataView) => void, length: number) => {
  const bytes = new Uint8Array(length);
  write(new DataView(bytes.buffer));
  return bytes;
};
const unsigned16 = (value: number) =>
  binary((view) => view.setUint16(0, value, true), 2);
const double = (value: number) =>
  binary((view) => view.setFloat64(0, value, true), 8);

/** A Sequence of Ultrasound Regions item in centimeters, or in seconds on x. */
const regionItem = (deltaX: number, deltaY: number, unitsX = 3) =>
  sequenceItem(
    Uint8Array.from([
      ...rawElement(0x0018, 0x6024, 'US', unsigned16(unitsX)),
      ...rawElement(0x0018, 0x6026, 'US', unsigned16(3)),
      ...rawElement(0x0018, 0x602c, 'FD', double(deltaX)),
      ...rawElement(0x0018, 0x602e, 'FD', double(deltaY)),
    ])
  );

describe('readCineHeader', () => {
  it('reads a Part 10 clip header without reading its pixels', async () => {
    const instance = await readClip({
      numberOfFrames: 5,
      rows: 4,
      cols: 3,
      pixelSpacing: [1.8, 0.45],
      patientName: 'DOE^JANE',
      patientId: 'P-77',
      seriesNumber: 12,
      studyDate: '20250304',
      extraElements: [
        rawElement(
          0x0018,
          0x6011,
          'SQ',
          Uint8Array.from([
            ...regionItem(0.5, 0.25, 4),
            ...regionItem(0.0125, 0.025),
          ])
        ),
      ],
    });

    expect(isCineInstance(instance)).toBe(true);
    expect(readCineHeader(instance)).toEqual({
      transferSyntaxUID: TS_EXPLICIT_VR_LE,
      rows: 4,
      cols: 3,
      numberOfFrames: 5,
      samplesPerPixel: 1,
      bitsAllocated: 8,
      planarConfiguration: 0,
      photometricInterpretation: 'MONOCHROME2',
      pixelSpacing: [1.8, 0.45],
      frameTimeMs: null,
      patient: {
        PatientID: 'P-77',
        PatientName: 'DOE^JANE',
        PatientBirthDate: '19700101',
        PatientSex: 'O',
      },
      study: {
        StudyID: '1',
        StudyInstanceUID: '1.2.3',
        StudyDate: '20250304',
        StudyTime: '',
        AccessionNumber: '',
        StudyDescription: '',
      },
      series: {
        SeriesInstanceUID: '1.2.3.4',
        SeriesNumber: '12',
        SeriesDescription: 'Synthetic cine',
        Modality: 'US',
      },
      regions: [
        {
          physicalDeltaX: 0.5,
          physicalDeltaY: 0.25,
          physicalUnitsXDirection: 4,
          physicalUnitsYDirection: 3,
        },
        {
          physicalDeltaX: 0.0125,
          physicalDeltaY: 0.025,
          physicalUnitsXDirection: 3,
          physicalUnitsYDirection: 3,
        },
      ],
    });
  });

  it('reads planar configuration and frame time', () => {
    expect(
      readCineHeader(
        cineInstance({
          [Tags.SamplesPerPixel]: '3',
          [Tags.PhotometricInterpretation]: 'RGB',
          '0028|0006': '1',
          [Tags.FrameTime]: '33.3',
        })
      )
    ).toMatchObject({
      samplesPerPixel: 3,
      planarConfiguration: 1,
      frameTimeMs: 33.3,
    });
  });
});

describe('a Part 10 JPEG Baseline clip', () => {
  const jpeg = (...body: number[]) =>
    Uint8Array.from([0xff, 0xd8, ...body, 0xff, 0xd9]);
  const first = jpeg(1, 2, 3);
  const second = jpeg(4, 5, 6, 7, 8);

  it.each([true, false])(
    'reads each frame from its value with a populated offset table: %s',
    async (offsetTable) => {
      const instance = await readClip({
        encapsulated: {
          frames: [[first], [second.subarray(0, 4), second.subarray(4)]],
          offsetTable,
        },
      });

      expect(isCineInstance(instance)).toBe(true);
      expect(instance.pixelData?.valueOffset).toBeGreaterThan(0);
      const header = readCineHeader(instance);
      expect(header).toMatchObject({
        transferSyntaxUID: TS_JPEG_BASELINE,
        numberOfFrames: 2,
      });
      const frames = await readCineFrames(instance, header, signal());
      expect(frames.map((frame) => [...frame])).toEqual([
        [...first],
        [...second],
      ]);
    }
  );
});
