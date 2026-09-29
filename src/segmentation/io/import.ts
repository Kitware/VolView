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
  type ParsedSegment,
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
  extentUnion,
  isEmptyExtent,
  maskOffset,
  type Extent3D,
  type MaskBounds,
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
} from '@/src/segmentation/io/labelmap';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';

type ImportedSegment = { sourceValue: number; maskId: string };

export const componentCount = (image: vtkImageData) =>
  image.getPointData().getScalars().getNumberOfComponents();

function labelMapOnGrid(
  imageData: vtkImageData,
  values: TypedArray,
  numberOfComponents: number
) {
  const labelmap = vtkLabelMap.newInstance(
    imageData.get('spacing', 'origin', 'direction', 'extent', 'dataDescription')
  );

  labelmap.setDimensions(imageData.getDimensions());
  labelmap.computeTransforms();
  labelmap
    .getPointData()
    .setScalars(vtkDataArray.newInstance({ numberOfComponents, values }));
  return labelmap;
}

export function toLabelMap(imageData: vtkImageData) {
  const { values, excluded } = normalizeLabelmapScalars(
    imageData.getPointData().getScalars().getData()
  );
  const labelmap = labelMapOnGrid(imageData, values, componentCount(imageData));
  return { labelmap, excluded };
}

/**
 * A saved mask's own archive entry as mask storage, where any nonzero voxel is
 * claimed: every reader tests for SEGMENT_VALUE. Undefined for a
 * multi-component entry, which bounded storage cannot index.
 */
export function toBinaryMask(imageData: vtkImageData) {
  if (componentCount(imageData) > 1) return undefined;
  const source = imageData.getPointData().getScalars().getData();
  const values = new Uint8Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    if (source[index]) values[index] = SEGMENT_VALUE;
  }
  return labelMapOnGrid(imageData, values, 1);
}

function extractEachComponent(input: vtkImageData) {
  if (componentCount(input) === 1) return [input];
  const extractComponentsFilter = vtkImageExtractComponents.newInstance();
  extractComponentsFilter.setInputData(input);
  return Array.from({ length: componentCount(input) }, (_, i) => {
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

type CropTarget = MaskBounds & { mask: Uint8Array };

type MaskMinter = (descriptor: LabelmapSegment, extent: Extent3D) => Uint8Array;

/**
 * Each descriptor gets a mask cropped to the box its value's voxels span,
 * holding SEGMENT_VALUE whatever the source called that value.
 */
export function splitLabelmap(
  labelmap: vtkLabelMap,
  descriptors: LabelmapSegment[],
  mint: MaskMinter
) {
  const scalars = labelmapScalars(labelmap);
  const [di, dj] = labelmap.getDimensions();
  const bounds = labelValueBounds(labelmap);

  // Indexed by source value, so the sweep below reads each voxel once however
  // many labels there are. Two descriptors may state one value.
  const targets: CropTarget[][] = [];
  descriptors.forEach((descriptor) => {
    const extent = bounds.get(descriptor.value) ?? emptyExtent();
    const mask = mint(descriptor, extent);
    if (isEmptyExtent(extent)) return;
    const [mi, mj] = extentSize(extent);
    const target = { extent, mi, mj, mask };
    (targets[descriptor.value] ??= []).push(target);
  });

  const copyRow = (j: number, k: number, i0: number, i1: number) => {
    const rowStart = (j + k * dj) * di;
    for (let i = i0; i <= i1; i += 1) {
      const hits = targets[scalars[rowStart + i]];
      if (!hits) continue;
      for (const hit of hits)
        hit.mask[maskOffset(hit, i, j, k)] = SEGMENT_VALUE;
    }
  };

  // A target's voxels all lie in its extent, so only their union is swept.
  const extents = targets.flat().map(({ extent }) => extent);
  if (!extents.length) return;
  const [i0, i1, j0, j1, k0, k1] = extents.reduce(extentUnion);
  for (let k = k0; k <= k1; k += 1)
    for (let j = j0; j <= j1; j += 1) copyRow(j, k, i0, i1);
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

export const distinctLabelValues = (image: vtkLabelMap) =>
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
  nextColor: () => RGBAColor;
};

/** A declared value is one bin per file, empty if no component carries it. */
const declaredOncePerFile = (
  merged: ParsedSegment[],
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
 * a loaded image dataset. DICOM-SEG decoding still requires a source image,
 * while an archive-backed image can supply its file-header metadata directly.
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
    color: options.nextColor(),
    visible: true,
  }));
  return declaredOncePerFile(merged, values, options.declared);
}

export type LabelmapImportHooks = {
  resample?: typeof ensureSameSpace;
  /**
   * Descriptors for one component. On the `last` one, a decode can add the
   * descriptors no component's voxels carried, once rather than per component.
   */
  decode: (
    labelmap: vtkLabelMap,
    component: number,
    last: boolean
  ) => Promise<LabelmapSegment[]>;
  /** Mints the masks for one decoded labelmap, in descriptor order. */
  split: (labelmap: vtkLabelMap, descriptors: LabelmapSegment[]) => string[];
  /** Told how many voxels of one component lost an unsupported label. */
  excluded?: (voxels: number) => void;
};

/**
 * Resampling and decoding both yield, and an image can be removed while they
 * run, so the parent is resolved through the cache again after every await:
 * nothing may be decoded or minted against an image that left the scene.
 */
function assertParentLoaded(parentID: DataSelection) {
  if (!getImage(parentID)) throw new Error('Parent image is no longer loaded');
}

/**
 * Returns the masks created per component of the source image (one entry
 * for the common single-component case), each paired with the source label
 * value it was split from. Every mask holds SEGMENT_VALUE, so the source value
 * is the only handle a caller's descriptors can match on.
 */
export async function importLabelmapImage(
  imageID: DataSelection,
  parentID: DataSelection,
  hooks: LabelmapImportHooks
) {
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

  const images = extractEachComponent(childImage);

  const prepared: Array<{
    labelmap: vtkLabelMap;
    descriptors: LabelmapSegment[];
  }> = [];
  const cache = useImageCacheStore();
  for (const [component, image] of images.entries()) {
    const matchingParentSpace = await (hooks.resample ?? ensureSameSpace)(
      parentImage,
      image,
      true
    );
    assertParentLoaded(parentID);
    const { labelmap: labelmapImage, excluded } =
      toLabelMap(matchingParentSpace);
    if (excluded) hooks.excluded?.(excluded);
    const descriptors = await hooks.decode(
      labelmapImage,
      component,
      component === images.length - 1
    );
    assertParentLoaded(parentID);
    if (!cache.imageById[imageID]) {
      throw new Error('Labelmap image is no longer loaded');
    }
    prepared.push({ labelmap: labelmapImage, descriptors });
  }

  // Finish fallible asynchronous work before creating any masks. The splits
  // commit in order without yielding, so each sees the preceding bindings.
  return prepared.map(({ labelmap, descriptors }): ImportedSegment[] =>
    hooks.split(labelmap, descriptors).map((maskId, index) => ({
      sourceValue: descriptors[index].value,
      maskId,
    }))
  );
}
