import vtkBoundingBox from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { RGBAColor } from '@kitware/vtk.js/types';

import { untilLoaded } from '@/src/composables/untilLoaded';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import { ensureSameSpace } from '@/src/io/resample/resample';
import {
  overlaySegmentMetadata,
  parseSegNrrdMetadata,
  type DecodedSegment,
} from '@/src/io/segNrrdMetadata';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { useImageCacheStore } from '@/src/store/image-cache';
import {
  LABELMAP_BACKGROUND_VALUE,
  makeDefaultSegmentName,
  type LabelmapSegment,
} from '@/src/segmentation/model';
import {
  emptyExtent,
  extentSize,
  isEmptyExtent,
  maskOffset,
  type Extent3D,
  growExtent,
} from '@/src/segmentation/geometry';
import {
  type DataSelection,
  getImage,
  isRegularImage,
} from '@/src/utils/dataSelection';
import vtkImageExtractComponents from '@/src/utils/imageExtractComponentsFilter';
import vtkLabelMap from '@/src/vtk/LabelMap';

import {
  labelmapScalars,
  normalizeLabelmapScalars,
  type LabelmapScalars,
} from '@/src/segmentation/io/labelmap';

/** A segment an import created, and the source label value it was split from. */
export type ImportedSegment = { sourceValue: number; maskId: string };

export function toLabelMap(imageData: vtkImageData) {
  const labelmap = vtkLabelMap.newInstance(
    imageData.get('spacing', 'origin', 'direction', 'extent', 'dataDescription')
  );

  labelmap.setDimensions(imageData.getDimensions());
  labelmap.computeTransforms();

  const source = imageData.getPointData().getScalars();
  const scalars = vtkDataArray.newInstance({
    numberOfComponents: source.getNumberOfComponents(),
    values: normalizeLabelmapScalars(source.getData()),
  });
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

// The decode and the split both need this sweep of the same buffer, and it is
// the whole parent volume, so the result rides along until the buffer changes.
const boundsCache = new WeakMap<
  vtkLabelMap,
  { mTime: number; bounds: Map<number, Extent3D> }
>();

/** The box a label value occupies, per value, in one sweep of the buffer. */
function labelValueBounds(labelmap: vtkLabelMap) {
  const cached = boundsCache.get(labelmap);
  if (cached?.mTime === labelmap.getMTime()) return cached.bounds;

  const scalars = labelmapScalars(labelmap);
  const [di, dj, dk] = labelmap.getDimensions();
  const bounds = new Map<number, Extent3D>();

  const scanRow = (rowStart: number, j: number, k: number) => {
    for (let i = 0; i < di; i += 1) {
      const value = scalars[rowStart + i];
      if (value === LABELMAP_BACKGROUND_VALUE) continue;
      const box = bounds.get(value);
      if (box) growExtent(box, i, j, k);
      else bounds.set(value, [i, i, j, j, k, k]);
    }
  };

  for (let k = 0; k < dk; k += 1)
    for (let j = 0; j < dj; j += 1) scanRow((j + k * dj) * di, j, k);

  boundsCache.set(labelmap, { mTime: labelmap.getMTime(), bounds });
  return bounds;
}

type LabelmapSweep = {
  scalars: LabelmapScalars;
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
  const bounds = { extent, mi, mj };

  const copyRow = (j: number, k: number) => {
    const sourceStart = (j + k * dj) * di;
    const maskStart = maskOffset(bounds, extent[0], j, k);
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
const distinctLabelValues = (image: vtkLabelMap) =>
  [...labelValueBounds(image).keys()].sort((first, second) => first - second);

export type DecodeOptions = {
  /** Which component of a multi-component DICOM-SEG to read descriptors from. */
  component?: number;
  /** File-header metadata, for bytes that never came through a loaded image. */
  headerMetadata?: Map<string, string>;
  /** What undescribed segments are named after, in place of 'Segment'. */
  baseName?: string;
  /**
   * The values the components read so far carry, and whether this is the last
   * component of the file. Reading one component of a multi-component labelmap
   * passes it, so a value the header describes but no component carries is
   * declared once for the file rather than once per component.
   */
  declared?: { covered: Set<number>; last: boolean };
  nextColor: () => readonly number[];
};

/**
 * The header's declarations, spread over the components of one file.
 * `overlaySegmentMetadata` appends every described value THIS component's
 * voxels miss, which is what a single-shot read wants and not what a file of
 * several components does: a declaration is one bin, so a value another
 * component carries is that component's segment and never an empty twin of it,
 * and a value none of them carries is one empty row, on the last component.
 */
const declaredOncePerFile = (
  merged: DecodedSegment[],
  carried: number[],
  declared: DecodeOptions['declared']
) => {
  if (!declared) return merged;
  const enumerated = new Set(carried);
  enumerated.forEach((value) => declared.covered.add(value));
  return merged.filter(
    (segment) =>
      enumerated.has(segment.value) ||
      (declared.last && !declared.covered.has(segment.value))
  );
};

/** A lone value carries the base name bare: there is nothing to tell apart. */
const fallbackNamer = (values: number[], baseName?: string) => {
  if (!baseName) return makeDefaultSegmentName;
  if (values.length === 1) return () => baseName;
  return (value: number) => `${baseName} ${value}`;
};

/**
 * `imageId` may be undefined when the labelmap's bytes did not arrive through
 * a loaded image dataset. DICOM-SEG decoding still
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
  // Overlay metadata so undescribed voxel values retain a default segment.
  const embedded =
    options.headerMetadata ??
    (imageId !== undefined
      ? useImageCacheStore().imageById[imageId]?.headerMetadata
      : undefined);
  const described = embedded ? parseSegNrrdMetadata(embedded) : undefined;

  const values = distinctLabelValues(image);
  const nameFor = fallbackNamer(values, options.baseName);

  const merged = overlaySegmentMetadata(values, described, (value) => ({
    value,
    name: nameFor(value),
    color: [...options.nextColor()] as RGBAColor,
    visible: true,
  }));
  return declaredOncePerFile(merged, values, options.declared);
}

export type LabelmapImportHooks = {
  /**
   * Descriptors for one component. `componentCount` is how many components
   * this image has in all, so a decode that adds a descriptor the voxels never
   * carried can add it once, on the last component, instead of once per
   * component -- a value can have voxels in one component and none in another.
   */
  decode: (
    labelmap: vtkLabelMap,
    component: number,
    componentCount: number
  ) => Promise<LabelmapSegment[]>;
  /** Mints the segments for one decoded labelmap, in descriptor order. */
  split: (labelmap: vtkLabelMap, descriptors: LabelmapSegment[]) => string[];
};

/**
 * Resampling and decoding both yield, and an image can be removed while they
 * run, so the parent is resolved through the cache again after every await:
 * nothing may be decoded or minted against an image that left the scene.
 */
function requireParentImage(parentID: DataSelection) {
  const parentImage = getImage(parentID);
  if (!parentImage) throw new Error('Parent image is no longer loaded');
  return parentImage;
}

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
    requireParentImage(parentID);
    const labelmapImage = toLabelMap(matchingParentSpace);
    const descriptors = await hooks.decode(
      labelmapImage,
      component,
      images.length
    );
    requireParentImage(parentID);
    created.push(
      hooks.split(labelmapImage, descriptors).map((maskId, index) => ({
        sourceValue: descriptors[index].value,
        maskId,
      }))
    );
  }
  return created;
}
