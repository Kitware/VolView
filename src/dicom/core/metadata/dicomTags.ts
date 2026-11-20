export const Tags = {
  SOPInstanceUID: '00080018',
  PatientName: '00100010',
  PatientID: '00100020',
  PatientBirthDate: '00100030',
  PatientSex: '00100040',
  StudyInstanceUID: '0020000D',
  StudyDate: '00080020',
  StudyTime: '00080030',
  StudyID: '00200010',
  AccessionNumber: '00080050',
  StudyDescription: '00081030',
  Modality: '00080060',
  SeriesInstanceUID: '0020000E',
  SeriesNumber: '00200011',
  SeriesDate: '00080021',
  SeriesDescription: '0008103E',
  InstanceNumber: '00200013',
  WindowLevel: '00281050',
  WindowWidth: '00281051',
  VOILUTFunction: '00281056',
  Rows: '00280010',
  Columns: '00280011',
  BitsAllocated: '00280100',
  BitsStored: '00280101',
  PixelRepresentation: '00280103',
  AcquisitionNumber: '00200012',
  TemporalPositionIdentifier: '00200100',
  EchoNumbers: '00180086',
  DiffusionBValue: '00189087',
  ImagePositionPatient: '00200032',
  ImageOrientationPatient: '00200037',
  PixelSpacing: '00280030',
  SpacingBetweenSlices: '00180088',
  SliceThickness: '00180050',
  SequenceName: '00180024',
  SamplesPerPixel: '00280002',
  RescaleIntercept: '00281052',
  RescaleSlope: '00281053',
  NumberOfFrames: '00280008',
  SOPClassUID: '00080016',
  OphthalmicVolumetricPropertiesFlag: '00221622',
  PhotometricInterpretation: '00280004',
  PlanarConfiguration: '00280006',
  FrameTime: '00181063',
  SequenceOfUltrasoundRegions: '00186011',
  PhysicalUnitsXDirection: '00186024',
  PhysicalUnitsYDirection: '00186026',
  PhysicalDeltaX: '0018602C',
  PhysicalDeltaY: '0018602E',
};

// DICOM SOP Class UIDs for Ultrasound Multi-frame Image Storage. The current
// identifier is .4.1.1.3.1; the retired pre-1993 identifier is .4.1.1.3.
// Some legacy clinical archives and well-known test corpora (e.g. GDCM's
// US-MONO2-8-8x-execho) still emit the retired UID.
export const SOP_CLASS_ULTRASOUND_MULTIFRAME = '1.2.840.10008.5.1.4.1.1.3.1';
export const SOP_CLASS_ULTRASOUND_MULTIFRAME_RETIRED =
  '1.2.840.10008.5.1.4.1.1.3';

export function isUltrasoundMultiframeSopClass(uid: string) {
  const trimmed = uid.trim();
  return (
    trimmed === SOP_CLASS_ULTRASOUND_MULTIFRAME ||
    trimmed === SOP_CLASS_ULTRASOUND_MULTIFRAME_RETIRED
  );
}
