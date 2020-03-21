// Common DICOM tags

/* eslint-disable key-spacing */
export default {
  PatientSex:           [0x0010, 0x0040],
  PatientBirthDate:     [0x0010, 0x0032],
  PatientComments:      [0x0010, 0x4000],

  StudyInstanceUID:     [0x0020, 0x000D],
  StudyID:              [0x0020, 0x0010],
  StudyAccessionNumber: [0x0008, 0x0050],
  StudyDescription:     [0x0008, 0x1030],

  SeriesDate:           [0x0008, 0x0021],
  SeriesTime:           [0x0008, 0x0031],

  ImageComments:        [0x0020, 0x4000],
};
/* eslint-enable key-spacing */
