import { Tags } from '@/src/core/dicomTags';

/**
 * The tags one synthetic instance carries, in the order the DICOM store reads
 * them. Everything a case does not vary (patient, study, and the series
 * identity the store groups on) is fixed here so specs only state what their
 * case is about.
 */
export type InstanceTags = {
  sopClassUid: string;
  numberOfFrames: string;
  sopInstanceUid: string;
  modality: string;
  seriesDescription: string;
};

export const instanceTags = ({
  sopClassUid,
  numberOfFrames,
  sopInstanceUid,
  modality,
  seriesDescription,
}: InstanceTags): Array<[string, string]> => [
  [Tags.SOPClassUID, sopClassUid],
  [Tags.NumberOfFrames, numberOfFrames],
  [Tags.SOPInstanceUID, sopInstanceUid],
  [Tags.PatientID, 'patient-1'],
  [Tags.PatientName, 'Test Patient'],
  [Tags.PatientBirthDate, ''],
  [Tags.PatientSex, ''],
  [Tags.StudyID, 'study-1'],
  [Tags.StudyInstanceUID, 'study-uid'],
  [Tags.StudyDate, ''],
  [Tags.StudyTime, ''],
  [Tags.AccessionNumber, ''],
  [Tags.StudyDescription, ''],
  [Tags.Modality, modality],
  [Tags.SeriesInstanceUID, 'series-uid'],
  [Tags.SeriesNumber, '7'],
  [Tags.SeriesDescription, seriesDescription],
  [Tags.WindowLevel, ''],
  [Tags.WindowWidth, ''],
];
