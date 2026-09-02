import { ref } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkBoundingBox from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import type { TypedArray } from '@kitware/vtk.js/types';
import { defineStore } from 'pinia';
import type { RGBAColor } from '@kitware/vtk.js/types';
import type { LabelmapSegment } from '@/src/types/segmentation';
import { DEFAULT_SEGMENT_MASKS, CATEGORICAL_COLORS } from '@/src/config';
import {
  parseSegNrrdMetadata,
  overlaySegmentMetadata,
} from '@/src/io/segNrrdMetadata';
import {
  type DataSelection,
  getImage,
  isRegularImage,
} from '@/src/utils/dataSelection';
import vtkImageExtractComponents from '@/src/utils/imageExtractComponentsFilter';
import { useImageCacheStore } from '@/src/store/image-cache';
import {
  useSegmentationStore,
  type ArtifactMetadata,
} from '@/src/store/segmentations';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import vtkLabelMap from '../vtk/LabelMap';
import { ensureSameSpace } from '../io/resample/resample';
import { untilLoaded } from '../composables/untilLoaded';

const LabelmapArrayType = Uint8Array;

export const LABELMAP_BACKGROUND_VALUE = 0;

/** Masks are Uint8Array, so a label value has to fit in one byte. */
export const LABELMAP_MAX_VALUE = 255;

/** A segment an import created, and the source label value it was split from. */
export type ImportedSegment = { sourceValue: number; segmentId: string };

export const makeDefaultSegmentName = (value: number) => `Segment ${value}`;
export const makeDefaultSegmentGroupName = (baseName: string, index: number) =>
  `Segment Group ${index} for ${baseName}`;

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

/** The artifact layer: labelmap bytes and decode. */
export const useSegmentGroupStore = defineStore('segmentGroup', () => {
  const imageCacheStore = useImageCacheStore();
  const segmentationStore = useSegmentationStore();

  /**
   * The image's segmentation, seeded with the default segments the first time.
   * One segmentation per image, so a repeat call adds nothing rather than
   * stacking another set of identically named defaults. Nothing is allocated:
   * the first edit on a segment materializes its mask.
   */
  function newLabelmapFromImage(parentID: string) {
    const imageData = imageCacheStore.getVtkImageData(parentID);
    if (!imageData) {
      return null;
    }

    const segmentation = segmentationStore.ensureSegmentationForImage(parentID);
    if (segmentation.order.length > 0) return segmentation.id;

    DEFAULT_SEGMENT_MASKS.forEach((descriptor) => {
      const segment = segmentationStore.createSegment(segmentation.id, {
        name: descriptor.name,
        color: [...descriptor.color] as RGBAColor,
      });
      segmentationStore.updateSegment(segment.id, {
        visible: descriptor.visible,
      });
    });
    return segmentation.id;
  }

  // Store-scoped on purpose, so it resets with the pinia instance: a
  // descriptor-less labelmap must decode to the same catalog whether it came
  // from a cold restore or a live conversion.
  let nextColorIndex = 0;
  function getNextColor() {
    const color = CATEGORICAL_COLORS[nextColorIndex];
    nextColorIndex = (nextColorIndex + 1) % CATEGORICAL_COLORS.length;
    return [...color, 255] as const;
  }

  // `imageId` may be undefined when the labelmap's bytes did not arrive
  // through a loaded image dataset (a zip-restored group). DICOM-SEG decoding
  // still requires a source image, while file-header metadata can be supplied
  // directly for archive-backed images.
  async function decodeSegments(
    imageId: DataSelection | undefined,
    image: vtkLabelMap,
    component = 0,
    headerMetadata?: Map<string, string>
  ) {
    const dicomStore = useDICOMStore();
    if (
      imageId !== undefined &&
      !isRegularImage(imageId) &&
      dicomStore.volumeInfo[imageId]?.kind !== 'cine'
    ) {
      await untilLoaded(imageId);

      const chunkImage = imageCacheStore.imageById[imageId] as DicomChunkImage;
      if (chunkImage.getModality() === 'SEG' && chunkImage.segBuildInfo) {
        const segments = chunkImage.segBuildInfo.segmentAttributes[component];
        return segments.map((segment) => ({
          value: segment.labelID,
          name: segment.SegmentLabel,
          color: [...segment.recommendedDisplayRGBValue, 255],
          visible: true,
        }));
      }
    }

    // Slicer-convention `.seg.nrrd` embedded metadata: a labelmap
    // produced by a backend CLI carries its real segment names/colors in the
    // NRRD header, captured onto the loaded image at import.
    //
    // MERGE, not replace: the distinct nonzero voxel values are the spine, so
    // a labelled voxel with NO `Segment{N}_*` block still gets a default,
    // visible, manageable segment instead of being dropped. Embedded
    // name/color/visibility are overlaid onto the matching `LabelValue == voxel
    // value`; undescribed values keep their default.
    const embedded =
      headerMetadata ??
      (imageId !== undefined
        ? imageCacheStore.imageById[imageId]?.headerMetadata
        : undefined);
    const described = embedded ? parseSegNrrdMetadata(embedded) : undefined;

    // Distinct nonzero voxel values, ascending — the segment spine.
    // Labelmap scalars are Uint8Array by construction (both callers pass a
    // `toLabelMap` result, which forces UInt8), so a fixed 256-slot presence map
    // gives one branch-free typed-array write per voxel on the hot path, and the
    // 0..255 sweep is already ascending (no Set, no per-voxel Number(), no sort).
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

    return overlaySegmentMetadata(values, described, (value) => ({
      value,
      name: makeDefaultSegmentName(value),
      color: [...getNextColor()],
      visible: true,
    }));
  }

  /**
   * Converts an image to a labelmap, one bounded mask per label value.
   *
   * Returns the segments created per component of the source image (one entry
   * for the common single-component case), each paired with the source label
   * value it was split from. A value already taken on the parent is remapped,
   * so the source value is the only handle a caller's descriptors can match on.
   */
  async function convertImageToLabelmap(
    imageID: DataSelection,
    parentID: DataSelection,
    source?: ArtifactMetadata['source']
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
        'Segment group and parent image bounds do not intersect. So there is no overlap in physical space.'
      );
    }

    const componentCount = childImage
      .getPointData()
      .getScalars()
      .getNumberOfComponents();
    // for each component, create create new vtkImageData with just one component, pulled from each component of childImage
    const images =
      componentCount === 1 ? [childImage] : extractEachComponent(childImage);

    // Sequential, not fanned out: the splits share one segmentation, and label
    // values are minted against the segments already in it.
    const created: ImportedSegment[][] = [];
    for (const [component, image] of images.entries()) {
      const matchingParentSpace = await ensureSameSpace(
        parentImage,
        image,
        true
      );
      const labelmapImage = toLabelMap(matchingParentSpace);

      const segments = (await decodeSegments(
        imageID,
        labelmapImage,
        component
      )) as LabelmapSegment[];

      const split = segmentationStore.splitLabelmapIntoSegments(
        parentID,
        labelmapImage,
        segments,
        source
      );
      created.push(
        split.map((segment, index) => ({
          sourceValue: segments[index].value,
          segmentId: segment.id,
        }))
      );
    }
    return created;
  }

  const saveFormat = ref('vti');

  // --- api --- //

  return {
    saveFormat,
    decodeSegments,
    newLabelmapFromImage,
    convertImageToLabelmap,
  };
});
