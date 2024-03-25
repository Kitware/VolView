import { computed, reactive, ref, toRaw, watch } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { defineStore } from 'pinia';
import { useImageStore } from '@/src/store/datasets-images';
import { join, normalize } from '@/src/utils/path';
import { useIdStore } from '@/src/store/id';
import { onImageDeleted } from '@/src/composables/onImageDeleted';
import { normalizeForStore, removeFromArray } from '@/src/utils';
import { compareImageSpaces } from '@/src/utils/imageSpace';
import { SegmentMask } from '@/src/types/segment';
import { DEFAULT_SEGMENT_MASKS } from '@/src/config';
import { readImage, writeImage } from '@/src/io/readWriteImage';
import type { RGBAColor } from '@kitware/vtk.js/types';
import vtkLabelMap from '../vtk/LabelMap';
import {
  StateFile,
  Manifest,
  SegmentGroupMetadata,
} from '../io/state-file/schema';
import { FileEntry } from '../io/types';
import {
  DataSelection,
  findImageID,
  getDataID,
  getImageID,
  selectionEquals,
} from './datasets';

const LabelmapArrayType = Uint8Array;
export type LabelmapArrayType = Uint8Array;

export const LABELMAP_BACKGROUND_VALUE = 0;
export const DEFAULT_SEGMENT_COLOR: RGBAColor = [255, 0, 0, 255];
export const makeDefaultSegmentName = (value: number) => `Segment ${value}`;
export const makeDefaultSegmentGroupName = (baseName: string, index: number) =>
  `Segment Group ${index} for ${baseName}`;

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

export function toLabelMap(imageData: vtkImageData) {
  const labelmap = vtkLabelMap.newInstance(
    imageData.get(
      'spacing',
      'origin',
      'direction',
      'extent',
      'dataDescription',
      'pointData'
    )
  );
  labelmap.setDimensions(imageData.getDimensions());
  labelmap.computeTransforms();

  return labelmap;
}

export const useSegmentGroupStore = defineStore('segmentGroup', () => {
  type _This = ReturnType<typeof useSegmentGroupStore>;

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

  /**
   * Creates a new labelmap entry from a parent/source image.
   */
  function newLabelmapFromImage(this: _This, parentID: string) {
    const imageStore = useImageStore();
    const imageData = imageStore.dataIndex[parentID];
    if (!imageData) {
      return null;
    }
    const { name: baseName } = imageStore.metadata[parentID];

    const labelmap = createLabelmapFromImage(imageData);

    const { order, byKey } = normalizeForStore(
      structuredClone(DEFAULT_SEGMENT_MASKS),
      'value'
    );

    // pick a unique name
    let name = '';
    const existingNames = new Set(
      Object.values(metadataByID).map((meta) => meta.name)
    );
    do {
      const nameIndex = nextDefaultIndex[parentID] ?? 1;
      nextDefaultIndex[parentID] = nameIndex + 1;
      name = makeDefaultSegmentGroupName(baseName, nameIndex);
    } while (existingNames.has(name));

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

  /**
   * Converts an image to a labelmap.
   * @param imageID
   * @param parentID
   */
  function convertImageToLabelmap(image: DataSelection, parent: DataSelection) {
    if (selectionEquals(image, parent))
      throw new Error('Cannot convert an image to be a labelmap of itself');

    const imageID = getImageID(image);
    const parentID = getImageID(parent);

    if (!imageID || !parentID)
      throw new Error('Image and/or parent datasets do not exist');

    const imageStore = useImageStore();
    const parentImage = imageStore.dataIndex[parentID];
    const childImage = imageStore.dataIndex[imageID];

    if (!compareImageSpaces(childImage, parentImage))
      throw new Error('Image does not match parent image space');

    const segmentGroupStore = useSegmentGroupStore();
    const labelmapImage = toLabelMap(childImage);
    const { order, byKey } = normalizeForStore(
      structuredClone(DEFAULT_SEGMENT_MASKS),
      'value'
    );
    segmentGroupStore.addLabelmap(labelmapImage, {
      name: imageStore.metadata[imageID].name,
      parentImage: parentID,
      segments: { order, byValue: byKey },
    });

    imageStore.deleteData(imageID);
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
      color: DEFAULT_SEGMENT_COLOR,
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

    // orderByParent is implicity preserved based on
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
            parentImage: getDataID(metadata.parentImage),
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

    const segmentGroupIDMap: Record<string, string> = {};

    // First restore the data, then restore the store.
    // This preserves ordering from orderByParent.

    const newLabelmapIDs = await Promise.all(
      labelMaps.map(async (labelMap) => {
        const [file] = stateFiles
          .filter(
            (entry) =>
              join(entry.archivePath, entry.file.name) ===
              normalize(labelMap.path)
          )
          .map((entry) => entry.file);

        const vtkImage = await readImage(file);
        const labelmapImage = toLabelMap(vtkImage);

        const id = useIdStore().nextId();
        dataIndex[id] = labelmapImage;
        return id;
      })
    );

    labelMaps.forEach((labelMap, index) => {
      const { metadata } = labelMap;
      // map parent id to new id
      const parentImage = findImageID(dataIDMap[metadata.parentImage]);
      metadata.parentImage = parentImage;

      const newID = newLabelmapIDs[index];
      segmentGroupIDMap[labelMap.id] = newID;

      metadataByID[newID] = metadata;
      orderByParent.value[parentImage] ??= [];
      orderByParent.value[parentImage].push(newID);
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
      orderByParent.value[parentID].forEach((segmentGroupID) => {
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
