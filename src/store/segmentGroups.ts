import { computed, reactive, ref, toRaw, watch } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkBoundingBox from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import type { TypedArray } from '@kitware/vtk.js/types';
import { defineStore } from 'pinia';
import { normalize } from '@/src/utils/path';
import { useIdStore } from '@/src/store/id';
import { onImageDeleted } from '@/src/composables/onImageDeleted';
import { normalizeForStore, removeFromArray } from '@/src/utils';
import { SegmentMask } from '@/src/types/segment';
import { DEFAULT_SEGMENT_MASKS, CATEGORICAL_COLORS } from '@/src/config';
import { readImage, writeImage } from '@/src/io/readWriteImage';
import {
  type DataSelection,
  getImage,
  isRegularImage,
} from '@/src/utils/dataSelection';
import vtkImageExtractComponents from '@/src/utils/imageExtractComponentsFilter';
import { useImageCacheStore } from '@/src/store/image-cache';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import vtkLabelMap from '../vtk/LabelMap';
import {
  StateFile,
  Manifest,
  SegmentGroupMetadata,
  LabelMap,
} from '../io/state-file/schema';
import { FileEntry } from '../io/types';
import { ensureSameSpace } from '../io/resample/resample';
import { untilLoaded } from '../composables/untilLoaded';
import { useDatasetStore } from './datasets';

const LabelmapArrayType = Uint8Array;
export type LabelmapArrayType = Uint8Array;

export const LABELMAP_BACKGROUND_VALUE = 0;
export const makeDefaultSegmentName = (value: number) => `Segment ${value}`;
export const makeDefaultSegmentGroupName = (baseName: string, index: number) =>
  `Segment Group ${index} for ${baseName}`;
const numberer = (index: number) => (index <= 1 ? '' : `${index}`); // start numbering at 2

export interface SegmentGroupMetadata {
  name: string;
  parentImage: string;
  segments: {
    order: number[];
    byValue: Record<number, SegmentMask>;
  };
}

export function createLabelmapFromImage(imageData: vtkImageData) {
  const points = new LabelmapArrayType(imageData.getNumberOfPoints());
  const labelmap = vtkLabelMap.newInstance(
    imageData.get('spacing', 'origin', 'direction')
  );
  labelmap.getPointData().setScalars(
    vtkDataArray.newInstance({
      numberOfComponents: 1,
      values: points,
    })
  );
  labelmap.setDimensions(imageData.getDimensions());
  labelmap.computeTransforms();

  return labelmap;
}

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

export function extractEachComponent(input: vtkImageData) {
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

export const useSegmentGroupStore = defineStore('segmentGroup', () => {
  type _This = ReturnType<typeof useSegmentGroupStore>;
  const imageCacheStore = useImageCacheStore();

  const dataIndex = reactive<Record<string, vtkLabelMap>>(Object.create(null));
  const metadataByID = reactive<Record<string, SegmentGroupMetadata>>(
    Object.create(null)
  );
  const orderByParent = ref<Record<string, string[]>>(Object.create(null));

  /**
   * Gets the metadata for a labelmap.
   * @param segmentGroupID
   * @param segmentValue
   */
  function getMetadata(segmentGroupID: string) {
    if (!(segmentGroupID in metadataByID))
      throw new Error('No such labelmap ID');
    return metadataByID[segmentGroupID];
  }

  /**
   * Gets a segment.
   * @param segmentGroupID
   * @param segmentValue
   * @returns
   */
  function getSegment(segmentGroupID: string, segmentValue: number) {
    const metadata = getMetadata(segmentGroupID);
    if (!(segmentValue in metadata.segments.byValue))
      throw new Error('No such segment');
    return metadata.segments.byValue[segmentValue];
  }

  /**
   * Validates that a segment does not violate constraints.
   *
   * Assumes that the given segment is not yet part of the labelmap segments.
   * @param segmentGroupID
   * @param segment
   */
  function validateSegment(segmentGroupID: string, segment: SegmentMask) {
    return (
      // cannot be zero (background)
      segment.value !== 0 &&
      // cannot already exist
      !(segment.value in getMetadata(segmentGroupID).segments.byValue)
    );
  }

  /**
   * Adds a given image + metadata as a labelmap.
   */
  function addLabelmap(
    this: _This,
    labelmap: vtkLabelMap,
    metadata: SegmentGroupMetadata
  ) {
    const id = useIdStore().nextId();

    dataIndex[id] = labelmap;
    metadataByID[id] = metadata;
    orderByParent.value[metadata.parentImage] ??= [];
    orderByParent.value[metadata.parentImage].push(id);

    return id;
  }

  // Used for constructing labelmap names in newLabelmapFromImage.
  const nextDefaultIndex: Record<string, number> = Object.create(null);

  // clear nextDefaultIndex
  onImageDeleted((deleted) => {
    deleted.forEach((id) => {
      delete nextDefaultIndex[id];
    });
  });

  function pickUniqueName(
    formatName: (index: number) => string,
    parentID: string
  ) {
    const existingNames = new Set(
      Object.values(metadataByID).map((meta) => meta.name)
    );
    let name = '';
    do {
      const nameIndex = nextDefaultIndex[parentID] ?? 1;
      nextDefaultIndex[parentID] = nameIndex + 1;
      name = formatName(nameIndex);
    } while (existingNames.has(name));
    return name;
  }

  /**
   * Creates a new labelmap entry from a parent/source image.
   */
  function newLabelmapFromImage(this: _This, parentID: string) {
    const imageData = imageCacheStore.getVtkImageData(parentID);
    if (!imageData) {
      return null;
    }
    const baseName =
      imageCacheStore.getImageMetadata(parentID)?.name ?? '(no name)';

    const labelmap = createLabelmapFromImage(imageData);

    const { order, byKey } = normalizeForStore(
      structuredClone(DEFAULT_SEGMENT_MASKS),
      'value'
    );

    const name = pickUniqueName(
      (index: number) => makeDefaultSegmentGroupName(baseName, index),
      parentID
    );

    return addLabelmap.call(this, labelmap, {
      name,
      parentImage: parentID,
      segments: { order, byValue: byKey },
    });
  }

  /**
   * Deletes a labelmap.
   */
  function removeGroup(id: string) {
    if (!(id in dataIndex)) return;
    const { parentImage } = metadataByID[id];
    removeFromArray(orderByParent.value[parentImage], id);
    delete dataIndex[id];
    delete metadataByID[id];
  }

  let nextColorIndex = 0;
  function getNextColor() {
    const color = CATEGORICAL_COLORS[nextColorIndex];
    nextColorIndex = (nextColorIndex + 1) % CATEGORICAL_COLORS.length;
    return [...color, 255] as const;
  }

  async function decodeSegments(
    imageId: DataSelection,
    image: vtkLabelMap,
    component = 0
  ) {
    if (!isRegularImage(imageId)) {
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

    const [min, max] = image.getPointData().getScalars().getRange();
    const noZeroBackground = Math.max(min, 1);
    const values = Array.from(
      { length: max - noZeroBackground + 1 },
      (_, i) => i + noZeroBackground
    );
    return values.map((value) => ({
      value,
      name: makeDefaultSegmentName(value),
      color: [...getNextColor()],
      visible: true,
    }));
  }

  /**
   * Converts an image to a labelmap.
   */
  async function convertImageToLabelmap(
    imageID: DataSelection,
    parentID: DataSelection
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
        'Segment group and parent image bounds do not intersect. So there is no overlap in physical space.'
      );
    }

    const baseName =
      imageCacheStore.getImageMetadata(imageID)?.name ?? '(no name)';

    const componentCount = childImage
      .getPointData()
      .getScalars()
      .getNumberOfComponents();
    // for each component, create create new vtkImageData with just one component, pulled from each component of childImage
    const images =
      componentCount === 1 ? [childImage] : extractEachComponent(childImage);

    images.forEach(async (image, component) => {
      const matchingParentSpace = await ensureSameSpace(
        parentImage,
        image,
        true
      );
      const labelmapImage = toLabelMap(matchingParentSpace);

      const segments = await decodeSegments(imageID, labelmapImage, component);
      const { order, byKey } = normalizeForStore(segments, 'value');
      const segmentGroupStore = useSegmentGroupStore();

      const name = pickUniqueName(
        (index: number) => `${baseName} ${numberer(index)}`,
        parentID
      );
      segmentGroupStore.addLabelmap(labelmapImage, {
        name,
        parentImage: parentID,
        segments: { order, byValue: byKey },
      });
    });
  }

  /**
   * Updates a labelmap's metadata
   * @param segmentGroupID
   * @param metadata
   */
  function updateMetadata(
    segmentGroupID: string,
    metadata: Partial<SegmentGroupMetadata>
  ) {
    metadataByID[segmentGroupID] = {
      ...getMetadata(segmentGroupID),
      ...metadata,
    };
  }

  /**
   * Creates a new default segment with an unallocated value.
   *
   * The value picked is the smallest unused value greater than 0.
   * @param segmentGroupID
   */
  function createNewSegment(segmentGroupID: string): SegmentMask {
    const { segments } = getMetadata(segmentGroupID);

    let value = 1;
    for (; value <= segments.order.length; value++) {
      if (!(value in segments.byValue)) break;
    }

    return {
      name: makeDefaultSegmentName(value),
      value,
      color: [...getNextColor()],
      visible: true,
      locked: false, // default to unlocked
    };
  }

  /**
   * Adds a segment to a labelmap.
   *
   * If no segment is provided, a default one is provided.
   * Duplicate segment values throw an error.
   * @param segmentGroupID
   * @param segment
   */
  function addSegment(segmentGroupID: string, segment?: SegmentMask) {
    const metadata = getMetadata(segmentGroupID);
    const seg = segment ?? createNewSegment(segmentGroupID);
    if (!validateSegment(segmentGroupID, seg))
      throw new Error('Invalid segment');
    metadata.segments.byValue[seg.value] = seg;
    metadata.segments.order.push(seg.value);
    return seg;
  }

  /**
   * Updates a segment's properties.
   *
   * Does not allow updating the segment value.
   * @param segmentGroupID
   * @param segmentValue
   * @param segmentUpdate
   */
  function updateSegment(
    segmentGroupID: string,
    segmentValue: number,
    segmentUpdate: Partial<Omit<SegmentMask, 'value'>>
  ) {
    const metadata = getMetadata(segmentGroupID);
    const segment = getSegment(segmentGroupID, segmentValue);
    metadata.segments.byValue[segmentValue] = {
      ...segment,
      ...segmentUpdate,
    };
  }

  /**
   * Deletes a segment from a labelmap.
   * @param segmentGroupID
   * @param segmentValue
   */
  function deleteSegment(segmentGroupID: string, segmentValue: number) {
    const { segments } = getMetadata(segmentGroupID);
    removeFromArray(segments.order, segmentValue);
    delete segments.byValue[segmentValue];

    dataIndex[segmentGroupID].replaceLabelValue(
      segmentValue,
      LABELMAP_BACKGROUND_VALUE
    );
  }

  const saveFormat = ref('vti');

  /**
   * Serializes the store's state.
   */
  async function serialize(state: StateFile) {
    const { zip } = state;

    // orderByParent is implicitly preserved based on
    // the order of serialized entries.

    const parents = Object.keys(orderByParent.value);
    const serialized = parents.flatMap((parentID) => {
      const segmentGroupIDs = orderByParent.value[parentID];
      return segmentGroupIDs.map((id) => {
        const metadata = metadataByID[id];
        return {
          id,
          path: `labels/${id}.${saveFormat.value}`,
          metadata: {
            ...metadata,
            parentImage: metadata.parentImage,
          },
        };
      });
    });

    state.manifest.labelMaps = serialized;

    // save labelmap images
    await Promise.all(
      serialized.map(async ({ id, path }) => {
        const vtkImage = dataIndex[id];
        const serializedImage = await writeImage(saveFormat.value, vtkImage);
        zip.file(path, serializedImage);
      })
    );
  }

  /**
   * Rehydrates the store's state.
   */
  async function deserialize(
    this: _This,
    manifest: Manifest,
    stateFiles: FileEntry[],
    dataIDMap: Record<string, string>
  ) {
    const { labelMaps } = manifest;
    const datasetStore = useDatasetStore();

    const segmentGroupIDMap: Record<string, string> = {};

    if (!labelMaps || labelMaps.length === 0) {
      return segmentGroupIDMap;
    }

    // First restore the data, then restore the store.
    // This preserves ordering from orderByParent.

    async function loadLabelMapImage(labelMap: LabelMap) {
      if (labelMap.dataSourceId !== undefined) {
        const storeId = dataIDMap[String(labelMap.dataSourceId)];
        await untilLoaded(storeId);
        const image = imageCacheStore.getVtkImageData(storeId);
        if (!image) {
          throw new Error(
            `Could not get image data for dataSourceId ${labelMap.dataSourceId}`
          );
        }
        return { image, storeIdToRemove: storeId };
      }

      const file = stateFiles.find(
        (entry) => entry.archivePath === normalize(labelMap.path!)
      )?.file;
      return { image: await readImage(file!) };
    }

    const labelmapResults = await Promise.all(
      labelMaps.map(async (labelMap) => {
        const { image, storeIdToRemove } = await loadLabelMapImage(labelMap);
        const labelmapImage = toLabelMap(image);

        const id = useIdStore().nextId();
        dataIndex[id] = labelmapImage;
        return { id, storeIdToRemove };
      })
    );

    labelMaps.forEach((labelMap, index) => {
      const { id: newID, storeIdToRemove } = labelmapResults[index];
      segmentGroupIDMap[labelMap.id] = newID;

      const parentImage = dataIDMap[labelMap.metadata.parentImage];
      metadataByID[newID] = { ...labelMap.metadata, parentImage };
      orderByParent.value[parentImage] ??= [];
      orderByParent.value[parentImage].push(newID);

      if (storeIdToRemove) {
        datasetStore.remove(storeIdToRemove);
      }
    });

    return segmentGroupIDMap;
  }

  // --- sync segments --- //

  const segmentByGroupID = computed(() => {
    return Object.entries(metadataByID).reduce<Record<string, SegmentMask[]>>(
      (acc, [id, metadata]) => {
        const {
          segments: { order, byValue },
        } = metadata;
        const segments = order.map((value) => byValue[value]);
        return { ...acc, [id]: segments };
      },
      {}
    );
  });

  watch(
    segmentByGroupID,
    (segsByID) => {
      Object.entries(segsByID).forEach(([id, segments]) => {
        // ensure segments are not proxies
        dataIndex[id].setSegments(toRaw(segments).map((seg) => toRaw(seg)));
      });
    },
    { immediate: true }
  );

  // --- handle deletions --- //

  onImageDeleted((deleted) => {
    deleted.forEach((parentID) => {
      orderByParent.value[parentID]?.forEach((segmentGroupID) => {
        removeGroup(segmentGroupID);
      });
    });
  });

  // --- api --- //

  return {
    dataIndex,
    metadataByID,
    orderByParent,
    segmentByGroupID,
    saveFormat,
    addLabelmap,
    newLabelmapFromImage,
    removeGroup,
    convertImageToLabelmap,
    updateMetadata,
    addSegment,
    getSegment,
    updateSegment,
    deleteSegment,
    serialize,
    deserialize,
  };
});
