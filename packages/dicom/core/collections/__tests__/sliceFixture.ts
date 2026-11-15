import { datasetFromTags } from '@/tests/dicomDataset';
import { Tags } from '../../metadata/dicomTags';
import { readInstanceDetails } from '../instanceFacts';

export const SERIES_UID = '1.2.826.0.1.3680043.9.7';
export const OTHER_SERIES_UID = '1.2.826.0.1.3680043.9.8';

export type SliceOptions = {
  sop?: string | null;
  series?: string | null;
  z?: number | null;
  rows?: string;
  orientation?: string | null;
  instanceNumber?: number | null;
  modality?: string;
  // Extra tags, keyed 'gggg|eeee'; a fixed tag given here is replaced.
  tags?: Record<string, string>;
};

let sopCounter = 0;

// A null value leaves its tag out.
const present = <T>(
  tag: string,
  value: T | null,
  format: (value: T) => string = String
): Array<[string, string]> => (value === null ? [] : [[tag, format(value)]]);

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

  return datasetFromTags(
    new Map([
      [Tags.StudyInstanceUID, '1.2.826.0.1.3680043.9.1'],
      [Tags.PatientID, 'patient-1'],
      [Tags.SeriesNumber, '1'],
      [Tags.Modality, modality],
      [Tags.Rows, rows],
      [Tags.Columns, '4'],
      [Tags.SamplesPerPixel, '1'],
      ...present(Tags.ImageOrientationPatient, orientation),
      ...present(Tags.SeriesInstanceUID, series),
      ...present(Tags.SOPInstanceUID, sop),
      ...present(Tags.ImagePositionPatient, z, (value) => `0\\0\\${value}`),
      ...present('0020|0013', instanceNumber),
      ...Object.entries(tags),
    ])
  );
}

/** The planner's facts for one slice, read the way a real header is. */
export const sliceFacts = (options: SliceOptions = {}) =>
  readInstanceDetails(sliceDataset(options)).facts;
