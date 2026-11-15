import { datasetFromTags, instanceFor } from '@/tests/dicomDataset';
import { createDicomRuntime } from '@/packages/dicom/core/runtime/createDicomRuntime';
import {
  fromBlob,
  type ByteSource,
} from '@/packages/dicom/core/source/byteSource';
import { getDatasetTag } from '@/packages/dicom/core/metadata/datasetAccess';
import { Tags } from '@/packages/dicom/core/metadata/dicomTags';
import type { Instance } from '@/packages/dicom/core/instance/readInstance';
import type { WholeInstanceDecode } from '@/packages/dicom/core/pixels/pixelDecoder';
import { onTestFinished, expect } from 'vitest';
import { decodingWith } from '@/tests/dicomVolumeFixtures';
import { tilt } from '@/tests/dicomOrientationFixtures';
import DicomVolumeImage from '@/src/core/streaming/dicomVolumeImage';
import { cineInstance } from '@/src/core/cine/__tests__/cineFixtures';
import {
  uriToDataSource,
  type DataSource,
  type DicomInstanceSource,
} from '@/src/io/import/dataSource';
import { FILE_EXT_TO_MIME } from '@/src/io/mimeTypes';
import type { ImportInstancesResult } from '@/src/store/datasets-dicom';

export const SERIES_UID = '1.2.826.0.1.3680043.9.7';
export const OTHER_SERIES_UID = '1.2.826.0.1.3680043.9.8';
export const STUDY_UID = '1.2.826.0.1.3680043.9.1';

type SliceOptions = {
  sop: string;
  series?: string;
  z?: number;
  rows?: string;
  orientation?: string;
  // Extra tags, keyed 'gggg|eeee'; a fixed tag given here is replaced.
  tags?: Record<string, string>;
  source?: ByteSource;
};

/** One planned slice header, as `readInstance` hands it back. */
export function sliceFor({
  sop,
  series = SERIES_UID,
  z = 0,
  rows = '4',
  orientation = '1\\0\\0\\0\\1\\0',
  tags = {},
  source = fromBlob(new Blob([sop])),
}: SliceOptions) {
  const metadata = [
    [Tags.SOPClassUID, '1.2.840.10008.5.1.4.1.1.4'],
    [Tags.NumberOfFrames, '1'],
    [Tags.SOPInstanceUID, sop],
    [Tags.PatientID, 'patient-1'],
    [Tags.PatientName, 'Test Patient'],
    [Tags.PatientBirthDate, ''],
    [Tags.PatientSex, ''],
    [Tags.StudyID, 'study-1'],
    [Tags.StudyInstanceUID, STUDY_UID],
    [Tags.StudyDate, ''],
    [Tags.StudyTime, ''],
    [Tags.AccessionNumber, ''],
    [Tags.StudyDescription, ''],
    [Tags.Modality, 'MR'],
    [Tags.SeriesInstanceUID, series],
    [Tags.SeriesNumber, '7'],
    [Tags.SeriesDescription, 'Imported series'],
    [Tags.WindowLevel, ''],
    [Tags.WindowWidth, ''],
    [Tags.Rows, rows],
    [Tags.Columns, '4'],
    [Tags.SamplesPerPixel, '1'],
    [Tags.BitsStored, '16'],
    [Tags.PixelRepresentation, '0'],
    [Tags.ImageOrientationPatient, orientation],
    [Tags.ImagePositionPatient, `0\\0\\${z}`],
    [Tags.InstanceNumber, String(z + 1)],
  ] as Array<[string, string]>;
  const merged = new Map([...metadata, ...Object.entries(tags)]);
  return instanceFor(datasetFromTags(merged), source);
}

/** Slices of one acquisition pass, tagged with its Acquisition Number. */
export const acquisition = (
  number: string,
  zs: number[],
  orientation?: string
) =>
  zs.map((z, i) =>
    sliceFor({
      sop: `acq${number}-${i}`,
      z,
      orientation,
      tags: { [Tags.AcquisitionNumber]: number },
    })
  );

/**
 * Orientation agreement is a tolerance, so a bucket depends on which instance
 * the walk meets first. `one` and `three` agree with each other and plan as a
 * single collection; once `zero` and `two` arrive the walk starts from `zero`,
 * and the pair splits into {zero, one} and {two, three}. Neither half holds a
 * plurality of the committed collection, so both mint fresh IDs and the
 * committed ID dissolves.
 */
export const splitting = () => ({
  zero: sliceFor({ sop: 'sop-0', z: 0, orientation: tilt(0) }),
  one: sliceFor({ sop: 'sop-1', z: 1, orientation: tilt(0.013) }),
  two: sliceFor({ sop: 'sop-2', z: 2, orientation: tilt(0.039) }),
  three: sliceFor({ sop: 'sop-3', z: 3, orientation: tilt(0.026) }),
});

/** A header no buffer type can be chosen for, so allocating its volume fails. */
export const unallocatableFor = (options: SliceOptions) =>
  sliceFor({ rows: '8', ...options, tags: { [Tags.BitsStored]: '' } });

export const ALLOCATION_FAILURE = /finite modality rescale range/;

export const sopOf = (instance: Instance) =>
  getDatasetTag(instance.dataset, Tags.SOPInstanceUID);

/** The one volume an import landed. */
export const onlyId = ({ volumes }: Pick<ImportInstancesResult, 'volumes'>) => {
  const ids = Object.keys(volumes);
  expect(ids).toHaveLength(1);
  return ids[0];
};

/** The message of the one series an import could not commit. */
export const onlyFailure = ({
  failures,
}: Pick<ImportInstancesResult, 'failures'>) => {
  expect(failures).toHaveLength(1);
  return failures[0].error.message;
};

/** An instance as the import pipeline hands it on, read from a URL. */
export const sourceFor = (instance: Instance) => {
  const name = `${sopOf(instance)}.dcm`;
  return {
    type: 'dicom',
    instance,
    parent: uriToDataSource(
      `https://example.test/${name}`,
      name,
      FILE_EXT_TO_MIME.dcm
    ),
  } satisfies DataSource & DicomInstanceSource;
};

/** The SOP Instance UIDs a dataset's saved provenance names, in order. */
export const sopsOfDataset = (dataSource: DataSource | undefined) => {
  if (dataSource?.type !== 'collection') throw new Error('Expected collection');
  return dataSource.sources.map((src) => {
    if (src.type !== 'dicom') throw new Error('Expected a DICOM source');
    return sopOf(src.instance);
  });
};

const numberTag = (instance: Instance, tag: string) =>
  Number(getDatasetTag(instance.dataset, tag));

/** Fills each slice with its InstanceNumber, without a decoder worker. */
const instanceNumberDecoder: WholeInstanceDecode = async ({ instance }) => {
  const size = [
    numberTag(instance, Tags.Columns),
    numberTag(instance, Tags.Rows),
    1,
  ] as const;
  return {
    size,
    data: new Uint16Array(size[0] * size[1]).fill(
      numberTag(instance, Tags.InstanceNumber)
    ),
    components: 1,
  };
};

// Module scope, so a live image does not pin the factory's record of images.
const noThumbnail = () => '';

/** Records every DICOM image the store creates, decoding without workers. */
export function imageFactory(
  decoder: WholeInstanceDecode = instanceNumberDecoder
) {
  const runtime = createDicomRuntime({
    ...decodingWith(decoder),
    decodeConcurrency: 1,
  });
  // A load that outlives its test calls store actions later, and an action
  // makes its own pinia the active one under whichever test runs then.
  onTestFinished(() => runtime.dispose());
  const created: DicomVolumeImage[] = [];
  const createImage = () => {
    const image = new DicomVolumeImage({
      runtime,
      encodeThumbnail: noThumbnail,
    });
    created.push(image);
    return image;
  };
  return { created, createImage, runtime };
}

/** The SOP Instance UIDs an image is built from, in planned order. */
export const membersOf = (image: DicomVolumeImage) =>
  image.getInstances().map(sopOf);

/** A single ultrasound multi-frame instance, which the store routes to cine. */
export const cineFor = (sop: string, { series = SERIES_UID } = {}) =>
  cineInstance({
    [Tags.SOPInstanceUID]: sop,
    [Tags.StudyInstanceUID]: STUDY_UID,
    [Tags.SeriesInstanceUID]: series,
    [Tags.SeriesNumber]: '7',
    [Tags.SeriesDescription]: 'Imported cine',
  });
