import { datasetFromTags } from '@/tests/dicomDataset';
import { Tags } from '../../metadata/dicomTags';

export const SERIES_UID = '1.2.826.0.1.3680043.9.7';
export const OTHER_SERIES_UID = '1.2.826.0.1.3680043.9.8';

export type SliceOptions = {
  sop?: string | null;
  series?: string | null;
  z?: number | null;
  rows?: string;
  orientation?: string;
  instanceNumber?: number | null;
  modality?: string;
  // Extra tags, keyed 'gggg|eeee'.
  tags?: Record<string, string>;
};

let sopCounter = 0;

/** A planner-ready MR slice header; every call mints a fresh SOP UID by default. */
export function sliceDataset(options: SliceOptions = {}) {
  const {
    sop = `sop-${(sopCounter += 1)}`,
    series = SERIES_UID,
    z = 0,
    rows = '4',
    orientation = '1\\0\\0\\0\\1\\0',
    instanceNumber = 1,
    modality = 'MR',
    tags = {},
  } = options;

  const entries: Array<[string, string]> = [
    [Tags.StudyInstanceUID, '1.2.826.0.1.3680043.9.1'],
    [Tags.PatientID, 'patient-1'],
    [Tags.SeriesNumber, '1'],
    [Tags.Modality, modality],
    [Tags.Rows, rows],
    [Tags.Columns, '4'],
    [Tags.SamplesPerPixel, '1'],
    [Tags.ImageOrientationPatient, orientation],
  ];
  if (series !== null) entries.push([Tags.SeriesInstanceUID, series]);
  if (sop !== null) entries.push([Tags.SOPInstanceUID, sop]);
  if (z !== null) entries.push([Tags.ImagePositionPatient, `0\\0\\${z}`]);
  if (instanceNumber !== null)
    entries.push(['0020|0013', String(instanceNumber)]);
  entries.push(...Object.entries(tags));

  return datasetFromTags(entries);
}
