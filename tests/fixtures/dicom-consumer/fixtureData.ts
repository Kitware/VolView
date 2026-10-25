import { buildSyntheticDicom } from '../../specs/syntheticDicom';

export const fixtureBytes = () =>
  buildSyntheticDicom({
    studyUid: '1.2.826.0.1.3680043.10.999.20',
    seriesUid: '1.2.826.0.1.3680043.10.999.21',
    sopUid: '1.2.826.0.1.3680043.10.999.22',
    instanceNumber: 1,
    imageOrientationPatient: [1, 0, 0, 0, 1, 0],
    imagePositionPatient: [10, 20, 30],
    pixelSpacing: [2, 3],
    spacingBetweenSlices: 4,
    pixelValue: 5,
    rescaleSlope: 2,
    rescaleIntercept: -20,
    patientName: 'EXTRACTED^DICOM',
  });
