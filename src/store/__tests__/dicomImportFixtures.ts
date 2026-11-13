import { datasetFromTags } from '@/tests/dicomDataset';
import { getDatasetTag } from '@/packages/dicom/core/metadata/datasetAccess';
import {
  SOP_CLASS_ULTRASOUND_MULTIFRAME,
  Tags,
} from '@/packages/dicom/core/metadata/dicomTags';
import type { Instance } from '@/packages/dicom/core/instance/readInstance';
import { instanceFor } from '@/packages/dicom/core/instance/__tests__/instanceFixture';
import {
  createDicomRuntime,
  type PixelDecoder,
} from '@/packages/dicom/core/runtime/createDicomRuntime';
import {
  fromBlob,
  type ByteSource,
} from '@/packages/dicom/core/source/byteSource';
import DicomVolumeImage from '@/src/core/streaming/dicomVolumeImage';

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

/** A header no buffer type can be chosen for, so allocating its volume fails. */
export const unallocatableFor = (options: SliceOptions) =>
  sliceFor({ rows: '8', ...options, tags: { [Tags.BitsStored]: '' } });

export const ALLOCATION_FAILURE = /finite modality rescale range/;

export const sopOf = (instance: Instance) =>
  getDatasetTag(instance.dataset, Tags.SOPInstanceUID);

const numberTag = (instance: Instance, tag: string) =>
  Number(getDatasetTag(instance.dataset, tag));

/** Fills each slice with its InstanceNumber, without a decoder worker. */
export const instanceNumberDecoder: PixelDecoder = async ({ instance }) => {
  const size = [
    numberTag(instance, Tags.Columns),
    numberTag(instance, Tags.Rows),
    1,
  ];
  return {
    size,
    data: new Uint16Array(size[0] * size[1]).fill(
      numberTag(instance, Tags.InstanceNumber)
    ),
    imageType: { components: 1 },
  };
};

// Module scope, so a live image does not pin the factory's record of images.
const noThumbnail = () => '';

/** Records every DICOM image the store creates, decoding without workers. */
export function imageFactory(decoder: PixelDecoder = instanceNumberDecoder) {
  const runtime = createDicomRuntime({ decoder, decodeConcurrency: 1 });
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
export function cineFor(
  sop: string,
  { series = SERIES_UID, source = fromBlob(new Blob([sop])) } = {}
) {
  const metadata = [
    [Tags.SOPClassUID, SOP_CLASS_ULTRASOUND_MULTIFRAME],
    [Tags.NumberOfFrames, '2'],
    [Tags.SOPInstanceUID, sop],
    [Tags.PatientID, 'patient-1'],
    [Tags.PatientName, 'Test Patient'],
    [Tags.StudyInstanceUID, STUDY_UID],
    [Tags.Modality, 'US'],
    [Tags.SeriesInstanceUID, series],
    [Tags.SeriesNumber, '7'],
    [Tags.SeriesDescription, 'Imported cine'],
    [Tags.Rows, '2'],
    [Tags.Columns, '2'],
    [Tags.SamplesPerPixel, '1'],
    [Tags.BitsStored, '8'],
    [Tags.PixelRepresentation, '0'],
  ] as Array<[string, string]>;
  return instanceFor(datasetFromTags(metadata), source);
}
