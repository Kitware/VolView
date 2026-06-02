type Tag = {
  name: string;
  tag: string;
};

const tags: Tag[] = [
  { name: 'SOPInstanceUID', tag: '0008|0018' },
  { name: 'PatientName', tag: '0010|0010' },
  { name: 'PatientID', tag: '0010|0020' },
  { name: 'PatientBirthDate', tag: '0010|0030' },
  { name: 'PatientSex', tag: '0010|0040' },
  { name: 'StudyInstanceUID', tag: '0020|000d' },
  { name: 'StudyDate', tag: '0008|0020' },
  { name: 'StudyTime', tag: '0008|0030' },
  { name: 'StudyID', tag: '0020|0010' },
  { name: 'AccessionNumber', tag: '0008|0050' },
  { name: 'StudyDescription', tag: '0008|1030' },
  { name: 'Modality', tag: '0008|0060' },
  { name: 'SeriesInstanceUID', tag: '0020|000e' },
  { name: 'SeriesNumber', tag: '0020|0011' },
  { name: 'SeriesDescription', tag: '0008|103e' },
  { name: 'WindowLevel', tag: '0028|1050' },
  { name: 'WindowWidth', tag: '0028|1051' },
  { name: 'Rows', tag: '0028|0010' },
  { name: 'Columns', tag: '0028|0011' },
  { name: 'BitsAllocated', tag: '0028|0100' },
  { name: 'BitsStored', tag: '0028|0101' },
  { name: 'PixelRepresentation', tag: '0028|0103' },
  { name: 'ImagePositionPatient', tag: '0020|0032' },
  { name: 'ImageOrientationPatient', tag: '0020|0037' },
  { name: 'PixelSpacing', tag: '0028|0030' },
  { name: 'SpacingBetweenSlices', tag: '0018|0088' },
  { name: 'SamplesPerPixel', tag: '0028|0002' },
  { name: 'RescaleIntercept', tag: '0028|1052' },
  { name: 'RescaleSlope', tag: '0028|1053' },
  { name: 'NumberOfFrames', tag: '0028|0008' },
  { name: 'SOPClassUID', tag: '0008|0016' },
  { name: 'PhotometricInterpretation', tag: '0028|0004' },
  { name: 'FrameTime', tag: '0018|1063' },
  { name: 'SequenceOfUltrasoundRegions', tag: '0018|6011' },
  { name: 'PhysicalUnitsXDirection', tag: '0018|6024' },
  { name: 'PhysicalUnitsYDirection', tag: '0018|6026' },
  { name: 'PhysicalDeltaX', tag: '0018|602c' },
  { name: 'PhysicalDeltaY', tag: '0018|602e' },
];

// DICOM SOP Class UIDs for Ultrasound Multi-frame Image Storage. The current
// identifier is .4.1.1.3.1; the retired pre-1993 identifier is .4.1.1.3.
// Some legacy clinical archives and well-known test corpora (e.g. GDCM's
// US-MONO2-8-8x-execho) still emit the retired UID.
export const SOP_CLASS_ULTRASOUND_MULTIFRAME = '1.2.840.10008.5.1.4.1.1.3.1';
export const SOP_CLASS_ULTRASOUND_MULTIFRAME_RETIRED =
  '1.2.840.10008.5.1.4.1.1.3';

export function isUltrasoundMultiframeSopClass(uid: string): boolean {
  const trimmed = uid.trim();
  return (
    trimmed === SOP_CLASS_ULTRASOUND_MULTIFRAME ||
    trimmed === SOP_CLASS_ULTRASOUND_MULTIFRAME_RETIRED
  );
}

export const TAG_TO_NAME = new Map(tags.map((t) => [t.tag, t.name]));
export const NAME_TO_TAG = new Map(tags.map((t) => [t.name, t.tag]));
export const Tags = Object.fromEntries(tags.map((t) => [t.name, t.tag]));

// Splits an itk-wasm-style "GGGG|EEEE" tag into the numeric [group, element]
// pair emitted by the streaming DICOM parser.
export const tagToGroupElement = (tag: string): [number, number] => {
  const [group, element] = tag.split('|');
  return [parseInt(group, 16), parseInt(element, 16)];
};
