export const Tags = {
  SOPInstanceUID: '0008|0018',
  PatientName: '0010|0010',
  PatientID: '0010|0020',
  PatientBirthDate: '0010|0030',
  PatientSex: '0010|0040',
  StudyInstanceUID: '0020|000d',
  StudyDate: '0008|0020',
  StudyTime: '0008|0030',
  StudyID: '0020|0010',
  AccessionNumber: '0008|0050',
  StudyDescription: '0008|1030',
  Modality: '0008|0060',
  SeriesInstanceUID: '0020|000e',
  SeriesNumber: '0020|0011',
  SeriesDate: '0008|0021',
  SeriesDescription: '0008|103e',
  InstanceNumber: '0020|0013',
  WindowLevel: '0028|1050',
  WindowWidth: '0028|1051',
  VOILUTFunction: '0028|1056',
  Rows: '0028|0010',
  Columns: '0028|0011',
  BitsAllocated: '0028|0100',
  BitsStored: '0028|0101',
  PixelRepresentation: '0028|0103',
  AcquisitionNumber: '0020|0012',
  TemporalPositionIdentifier: '0020|0100',
  EchoNumbers: '0018|0086',
  DiffusionBValue: '0018|9087',
  ImagePositionPatient: '0020|0032',
  ImageOrientationPatient: '0020|0037',
  PixelSpacing: '0028|0030',
  SpacingBetweenSlices: '0018|0088',
  SliceThickness: '0018|0050',
  SequenceName: '0018|0024',
  SamplesPerPixel: '0028|0002',
  RescaleIntercept: '0028|1052',
  RescaleSlope: '0028|1053',
  NumberOfFrames: '0028|0008',
  SOPClassUID: '0008|0016',
  OphthalmicVolumetricPropertiesFlag: '0022|1622',
  PhotometricInterpretation: '0028|0004',
  PlanarConfiguration: '0028|0006',
  FrameTime: '0018|1063',
  SequenceOfUltrasoundRegions: '0018|6011',
  PhysicalUnitsXDirection: '0018|6024',
  PhysicalUnitsYDirection: '0018|6026',
  PhysicalDeltaX: '0018|602c',
  PhysicalDeltaY: '0018|602e',
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
