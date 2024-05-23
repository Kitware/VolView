interface Tag {
  name: string;
  tag: string;
}

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
  { name: 'SamplesPerPixel', tag: '0028|0002' },
  { name: 'RescaleIntercept', tag: '0028|1052' },
  { name: 'RescaleSlope', tag: '0028|1053' },
];

export const TAG_TO_NAME = new Map(tags.map((t) => [t.tag, t.name]));
export const NAME_TO_TAG = new Map(tags.map((t) => [t.name, t.tag]));
export const Tags = Object.fromEntries(tags.map((t) => [t.name, t.tag]));
