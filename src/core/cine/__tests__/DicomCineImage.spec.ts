import { describe, expect, it } from 'vitest';

import DicomCineImage from '../DicomCineImage';
import type { CineHeader, CineParseResult } from '../parseCineDicom';

const TS_EXPLICIT_VR_LE = '1.2.840.10008.1.2.1';
const TS_JPEG_BASELINE = '1.2.840.10008.1.2.4.50';
const TS_JPEG_EXTENDED = '1.2.840.10008.1.2.4.51';
const TS_UNSUPPORTED = '1.2.840.10008.1.2.5';

function cineHeader(overrides: Partial<CineHeader> = {}): CineHeader {
  return {
    transferSyntaxUID: TS_EXPLICIT_VR_LE,
    rows: 2,
    cols: 2,
    numberOfFrames: 2,
    samplesPerPixel: 1,
    bitsAllocated: 8,
    planarConfiguration: 0,
    photometricInterpretation: 'MONOCHROME2',
    frameTimeMs: null,
    patient: {
      PatientID: 'patient-1',
      PatientName: 'Test Patient',
      PatientBirthDate: '',
      PatientSex: '',
    },
    study: {
      StudyID: 'study-1',
      StudyInstanceUID: 'study-uid',
      StudyDate: '',
      StudyTime: '',
      AccessionNumber: '',
      StudyDescription: '',
    },
    series: {
      SeriesInstanceUID: 'series-uid',
      SeriesNumber: '1',
      SeriesDescription: 'Cine',
      Modality: 'US',
      SOPInstanceUID: 'sop-uid',
      SOPClassUID: '1.2.840.10008.5.1.4.1.1.3.1',
    },
    regions: [],
    ...overrides,
  };
}

function parseResult(header: CineHeader): CineParseResult {
  return {
    header,
    frames: [new Uint8Array(4), new Uint8Array(4)],
    encapsulated: false,
  };
}

describe('DicomCineImage.isSupported', () => {
  it('accepts only MONOCHROME2 for native one-sample 8-bit pixels', () => {
    expect(DicomCineImage.isSupported(cineHeader())).toBe(true);

    ['MONOCHROME1', 'PALETTE COLOR', 'RGB', 'YBR_FULL', 'YBR_FULL_422'].forEach(
      (photometricInterpretation) => {
        expect(
          DicomCineImage.isSupported(cineHeader({ photometricInterpretation }))
        ).toBe(false);
      }
    );
  });

  it('accepts only RGB for native three-sample 8-bit pixels', () => {
    expect(
      DicomCineImage.isSupported(
        cineHeader({
          samplesPerPixel: 3,
          photometricInterpretation: 'RGB',
        })
      )
    ).toBe(true);

    [
      'MONOCHROME2',
      'MONOCHROME1',
      'PALETTE COLOR',
      'YBR_FULL',
      'YBR_FULL_422',
    ].forEach((photometricInterpretation) => {
      expect(
        DicomCineImage.isSupported(
          cineHeader({
            samplesPerPixel: 3,
            photometricInterpretation,
          })
        )
      ).toBe(false);
    });
  });

  it('rejects native pixels unless BitsAllocated is 8', () => {
    expect(DicomCineImage.isSupported(cineHeader({ bitsAllocated: 16 }))).toBe(
      false
    );
  });

  it('keeps encapsulated support scoped to transfer syntax acceptance', () => {
    expect(
      DicomCineImage.isSupported(
        cineHeader({
          transferSyntaxUID: TS_JPEG_BASELINE,
          bitsAllocated: 16,
          samplesPerPixel: 3,
          photometricInterpretation: 'YBR_FULL_422',
        })
      )
    ).toBe(true);

    expect(
      DicomCineImage.isSupported(
        cineHeader({
          transferSyntaxUID: TS_UNSUPPORTED,
          photometricInterpretation: 'RGB',
        })
      )
    ).toBe(false);

    expect(
      DicomCineImage.isSupported(
        cineHeader({
          transferSyntaxUID: TS_JPEG_EXTENDED,
          photometricInterpretation: 'YBR_FULL_422',
        })
      )
    ).toBe(false);
  });
});

describe('DicomCineImage spacing', () => {
  it('uses the first spatial 2D ultrasound region instead of the first region overall', () => {
    const image = new DicomCineImage(
      parseResult(
        cineHeader({
          regions: [
            {
              minX0: 0,
              minY0: 0,
              maxX1: 1,
              maxY1: 1,
              physicalDeltaX: 10,
              physicalDeltaY: 10,
              physicalUnitsX: 1,
              physicalUnitsY: 3,
            },
            {
              minX0: 0,
              minY0: 0,
              maxX1: 1,
              maxY1: 1,
              physicalDeltaX: -0.05,
              physicalDeltaY: 0.125,
              physicalUnitsX: 3,
              physicalUnitsY: 3,
            },
          ],
        })
      )
    );

    expect(Array.from(image.getVtkImageData().getSpacing())).toEqual([
      0.5, 1.25, 1,
    ]);

    image.dispose();
  });
});
