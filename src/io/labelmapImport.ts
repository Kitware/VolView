import vtkBoundingBox from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { RGBAColor, TypedArray } from '@kitware/vtk.js/types';

import { untilLoaded } from '@/src/composables/untilLoaded';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import { ensureSameSpace } from '@/src/io/resample/resample';
import {
  overlaySegmentMetadata,
  parseSegNrrdMetadata,
} from '@/src/io/segNrrdMetadata';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { useImageCacheStore } from '@/src/store/image-cache';
import {
  emptyExtent,
  extentSize,
  isEmptyExtent,
  LABELMAP_BACKGROUND_VALUE,
  makeDefaultSegmentName,
  type Extent3D,
  type LabelmapSegment,
} from '@/src/types/segmentation';
import {
  type DataSelection,
  getImage,
  isRegularImage,
} from '@/src/utils/dataSelection';
import vtkImageExtractComponents from '@/src/utils/imageExtractComponentsFilter';
import vtkLabelMap from '@/src/vtk/LabelMap';

const LabelmapArrayType = Uint8Array;

/** A segment an import created, and the source label value it was split from. */
export type ImportedSegment = { sourceValue: number; segmentId: string };

function convertToUint8(array: number[] | TypedArray): Uint8Array {
  const uint8Array = new Uint8Array(array.length);
  for (let i = 0; i < array.length; i++) {
    const value = array[i];
    uint8Array[i] = value < 0 || value > 255 ? 0 : value;
  }
  return uint8Array;
}

function getLabelMapScalars(imageData: vtkImageData) {
  const scalars = imageData.getPointData().getScalars();
  let values = scalars.getData();

  if (!(values instanceof LabelmapArrayType)) {
    values = convertToUint8(values);
  }

  return vtkDataArray.newInstance({
    numberOfComponents: scalars.getNumberOfComponents(),
    values,
  });
}

export function toLabelMap(imageData: vtkImageData) {
  const labelmap = vtkLabelMap.newInstance(
    imageData.get('spacing', 'origin', 'direction', 'extent', 'dataDescription')
  );

  labelmap.setDimensions(imageData.getDimensions());
  labelmap.computeTransforms();

  // outline rendering only supports UInt8Array image types
  const scalars = getLabelMapScalars(imageData);
  labelmap.getPointData().setScalars(scalars);

  return labelmap;
}

function extractEachComponent(input: vtkImageData) {
  const numComponents = input
    .getPointData()
    .getScalars()
    .getNumberOfComponents();
  const extractComponentsFilter = vtkImageExtractComponents.newInstance();
  extractComponentsFilter.setInputData(input);
  return Array.from({ length: numComponents }, (_, i) => {
    extractComponentsFilter.setComponents([i]);
    extractComponentsFilter.update();
    return extractComponentsFilter.getOutputData() as vtkImageData;
  });
}

const labelmapScalars = (labelmap: vtkLabelMap) =>
  labelmap.getPointData().getScalars().getData() as Uint8Array;

const growBox = (box: Extent3D, i: number, j: number, k: number) => {
  box[0] = Math.min(box[0], i);
  box[1] = Math.max(box[1], i);
  box[2] = Math.min(box[2], j);
  box[3] = Math.max(box[3], j);
  box[4] = Math.min(box[4], k);
  box[5] = Math.max(box[5], k);
};

/** The box a label value occupies, per value, in one sweep of the buffer. */
export function labelValueBounds(labelmap: vtkLabelMap) {
  const scalars = labelmapScalars(labelmap);
  const [di, dj, dk] = labelmap.getDimensions();
  const bounds = new Map<number, Extent3D>();

  const scanRow = (rowStart: number, j: number, k: number) => {
    for (let i = 0; i < di; i += 1) {
      const value = scalars[rowStart + i];
      if (value === LABELMAP_BACKGROUND_VALUE) continue;
      const box = bounds.get(value);
      if (box) growBox(box, i, j, k);
      else bounds.set(value, [i, i, j, j, k, k]);
    }
  };

  for (let k = 0; k < dk; k += 1)
    for (let j = 0; j < dj; j += 1) scanRow((j + k * dj) * di, j, k);

  return bounds;
}

type LabelmapSweep = {
  scalars: Uint8Array;
  dimensions: number[] | Int32Array;
  value: number;
};

/** Copies one label value's voxels into `mask`, rewritten to `labelValue`. */
function cropLabelValue(
  sweep: LabelmapSweep,
  extent: Extent3D,
  mask: Uint8Array,
  labelValue: number
) {
  const [di, dj] = sweep.dimensions;
  const [mi, mj] = extentSize(extent);

  const copyRow = (j: number, k: number) => {
    const sourceStart = (j + k * dj) * di;
    const maskStart = (j - extent[2]) * mi + (k - extent[4]) * mi * mj;
    for (let i = extent[0]; i <= extent[1]; i += 1) {
      if (sweep.scalars[sourceStart + i] !== sweep.value) continue;
      mask[maskStart + i - extent[0]] = labelValue;
    }
  };

  for (let k = extent[4]; k <= extent[5]; k += 1)
    for (let j = extent[2]; j <= extent[3]; j += 1) copyRow(j, k);
}

/** Storage for one descriptor's segment, minted by the caller. */
export type MaskMinter = (
  descriptor: LabelmapSegment,
  extent: Extent3D
) => { labelValue: number; mask: Uint8Array };

/**
 * One bounded mask per label value. An imported or legacy labelmap carries
 * every segment in one buffer; each descriptor gets a mask cropped to the box
 * that value's voxels span, filled with the value the minter assigned it.
 */
export function splitLabelmap(
  labelmap: vtkLabelMap,
  descriptors: LabelmapSegment[],
  mint: MaskMinter
) {
  const scalars = labelmapScalars(labelmap);
  const dimensions = labelmap.getDimensions();
  const bounds = labelValueBounds(labelmap);

  descriptors.forEach((descriptor) => {
    const extent = bounds.get(descriptor.value) ?? emptyExtent();
    const { labelValue, mask } = mint(descriptor, extent);
    if (isEmptyExtent(extent)) return;
    cropLabelValue(
      { scalars, dimensions, value: descriptor.value },
      extent,
      mask,
      labelValue
    );
  });
}

/** DICOM-SEG carries its own catalog; anything else has to be derived. */
async function segBuildDescriptors(
  imageId: DataSelection | undefined,
  component: number
) {
  if (imageId === undefined || isRegularImage(imageId)) return undefined;
  if (useDICOMStore().volumeInfo[imageId]?.kind === 'cine') return undefined;

  await untilLoaded(imageId);
  const chunkImage = useImageCacheStore().imageById[imageId] as DicomChunkImage;
  if (chunkImage.getModality() !== 'SEG' || !chunkImage.segBuildInfo)
    return undefined;

  return chunkImage.segBuildInfo.segmentAttributes[component].map(
    (segment) => ({
      value: segment.labelID,
      name: segment.SegmentLabel,
      color: [...segment.recommendedDisplayRGBValue, 255] as RGBAColor,
      visible: true,
    })
  );
}

/** Distinct nonzero voxel values, ascending: the segment spine. */
function distinctLabelValues(image: vtkLabelMap) {
  // Labelmap scalars are Uint8Array by construction (every caller passes a
  // `toLabelMap` result), so a fixed 256-slot presence map gives one
  // branch-free typed-array write per voxel on the hot path, and the 0..255
  // sweep is already ascending (no Set, no per-voxel Number(), no sort).
  const voxelValues = image.getPointData().getScalars().getData();
  const present = new Uint8Array(256);
  for (let index = 0; index < voxelValues.length; index += 1) {
    present[voxelValues[index]] = 1;
  }
  const values: number[] = [];
  for (let value = 0; value < present.length; value += 1) {
    if (present[value] && value !== LABELMAP_BACKGROUND_VALUE)
      values.push(value);
  }
  return values;
}

export type DecodeOptions = {
  /** Which component of a multi-component DICOM-SEG to read descriptors from. */
  component?: number;
  /** File-header metadata, for bytes that never came through a loaded image. */
  headerMetadata?: Map<string, string>;
  /** What undescribed segments are named after, in place of 'Segment'. */
  baseName?: string;
  nextColor: () => readonly number[];
};

/** A lone value carries the base name bare: there is nothing to tell apart. */
const fallbackNamer = (values: number[], baseName?: string) => {
  if (!baseName) return makeDefaultSegmentName;
  if (values.length === 1) return () => baseName;
  return (value: number) => `${baseName} ${value}`;
};

/**
 * `imageId` may be undefined when the labelmap's bytes did not arrive through
 * a loaded image dataset (a zip-restored artifact). DICOM-SEG decoding still
 * requires a source image, while file-header metadata can be supplied directly
 * for archive-backed images.
 */
export async function decodeLabelmapSegments(
  imageId: DataSelection | undefined,
  image: vtkLabelMap,
  options: DecodeOptions
) {
  const fromSegBuild = await segBuildDescriptors(
    imageId,
    options.component ?? 0
  );
  if (fromSegBuild) return fromSegBuild;

  // Slicer-convention `.seg.nrrd` embedded metadata: a labelmap produced by a
  // backend CLI carries its real segment names/colors in the NRRD header,
  // captured onto the loaded image at import.
  //
  // MERGE, not replace: the distinct nonzero voxel values are the spine, so a
  // labelled voxel with NO `Segment{N}_*` block still gets a default, visible,
  // manageable segment instead of being dropped. Embedded name/color/
  // visibility are overlaid onto the matching `LabelValue == voxel value`;
  // undescribed values keep their default.
  const embedded =
    options.headerMetadata ??
    (imageId !== undefined
      ? useImageCacheStore().imageById[imageId]?.headerMetadata
      : undefined);
  const described = embedded ? parseSegNrrdMetadata(embedded) : undefined;

  const values = distinctLabelValues(image);
  const nameFor = fallbackNamer(values, options.baseName);

  return overlaySegmentMetadata(values, described, (value) => ({
    value,
    name: nameFor(value),
    color: [...options.nextColor()] as RGBAColor,
    visible: true,
  }));
}

export type LabelmapImportHooks = {
  decode: (
    labelmap: vtkLabelMap,
    component: number
  ) => Promise<LabelmapSegment[]>;
  /** Mints the segments for one decoded labelmap, in descriptor order. */
  split: (labelmap: vtkLabelMap, descriptors: LabelmapSegment[]) => string[];
};

/**
 * Converts an image to a labelmap, one bounded mask per label value.
 *
 * Returns the segments created per component of the source image (one entry
 * for the common single-component case), each paired with the source label
 * value it was split from. A value already taken on the parent is remapped, so
 * the source value is the only handle a caller's descriptors can match on.
 */
export async function importLabelmapImage(
  imageID: DataSelection,
  parentID: DataSelection,
  hooks: LabelmapImportHooks
): Promise<ImportedSegment[][]> {
  if (imageID === parentID)
    throw new Error('Cannot convert an image to be a labelmap of itself');

  await untilLoaded(imageID);

  const [childImage, parentImage] = await Promise.all(
    [imageID, parentID].map(getImage)
  );

  if (!childImage || !parentImage)
    throw new Error('Image and/or parent datasets do not exist');

  const intersects = vtkBoundingBox.intersects(
    parentImage.getBounds(),
    childImage.getBounds()
  );
  if (!intersects) {
    throw new Error(
      'Imported image and parent image bounds do not intersect. So there is no overlap in physical space.'
    );
  }

  const componentCount = childImage
    .getPointData()
    .getScalars()
    .getNumberOfComponents();
  const images =
    componentCount === 1 ? [childImage] : extractEachComponent(childImage);

  // Sequential, not fanned out: the splits share one segmentation, and label
  // values are minted against the segments already in it.
  const created: ImportedSegment[][] = [];
  for (const [component, image] of images.entries()) {
    const matchingParentSpace = await ensureSameSpace(parentImage, image, true);
    const labelmapImage = toLabelMap(matchingParentSpace);
    const descriptors = await hooks.decode(labelmapImage, component);
    created.push(
      hooks.split(labelmapImage, descriptors).map((segmentId, index) => ({
        sourceValue: descriptors[index].value,
        segmentId,
      }))
    );
  }
  return created;
}
