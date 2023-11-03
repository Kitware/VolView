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
import { LabelMapSegment } from '@/src/types/labelmap';
import { DEFAULT_LABELMAP_SEGMENTS } from '@/src/config';
import { RGBAColor } from '@kitware/vtk.js/types';
import vtkLabelMap from '../vtk/LabelMap';
import { StateFile, Manifest, LabelMapMetadata } from '../io/state-file/schema';
import { vtiReader, vtiWriter } from '../io/vtk/async';
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
export const ERASER_SEGMENT: LabelMapSegment = {
  name: 'Eraser',
  value: 0,
  color: [0, 0, 0, 0],
};
export const makeDefaultSegmentName = (value: number) => `Segment ${value}`;
export const makeDefaultLabelmapName = (baseName: string, index: number) =>
  `Labelmap ${index} for ${baseName}`;

export interface LabelMapMetadata {
  name: string;
  parentImage: string;
  segments: {
    order: number[];
    byValue: Record<number, LabelMapSegment>;
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

export const useLabelmapStore = defineStore('labelmap', () => {
  type _This = ReturnType<typeof useLabelmapStore>;

  const dataIndex = reactive<Record<string, vtkLabelMap>>(Object.create(null));
  const labelmapMetadata = reactive<Record<string, LabelMapMetadata>>(
    Object.create(null)
  );
  const orderByParent = ref<Record<string, string[]>>(Object.create(null));

  /**
   * Gets the metadata for a labelmap.
   * @param labelmapID
   * @param segmentValue
   */
  function getMetadata(labelmapID: string) {
    if (!(labelmapID in labelmapMetadata))
      throw new Error('No such labelmap ID');
    return labelmapMetadata[labelmapID];
  }

  /**
   * Gets a segment.
   * @param labelmapID
   * @param segmentValue
   * @returns
   */
  function getSegment(labelmapID: string, segmentValue: number) {
    const metadata = getMetadata(labelmapID);
    if (!(segmentValue in metadata.segments.byValue))
      throw new Error('No such segment');
    return metadata.segments.byValue[segmentValue];
  }

  /**
   * Validates that a segment does not violate constraints.
   *
   * Assumes that the given segment is not yet part of the labelmap segments.
   * @param labelmapID
   * @param segment
   */
  function validateSegment(labelmapID: string, segment: LabelMapSegment) {
    return (
      // cannot be zero (background)
      segment.value !== 0 &&
      // cannot already exist
      !(segment.value in getMetadata(labelmapID).segments.byValue)
    );
  }

  /**
   * Adds a given image + metadata as a labelmap.
   */
  function addLabelmap(
    this: _This,
    labelmap: vtkLabelMap,
    metadata: LabelMapMetadata
  ) {
    const id = useIdStore().nextId();

    dataIndex[id] = labelmap;
    labelmapMetadata[id] = metadata;
    orderByParent.value[metadata.parentImage] ??= [];
    orderByParent.value[metadata.parentImage].push(id);

    this.$proxies.addData(id, labelmap);

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
      structuredClone(DEFAULT_LABELMAP_SEGMENTS),
      'value'
    );

    // pick a unique name
    let name = '';
    const existingNames = new Set(
      Object.values(labelmapMetadata).map((meta) => meta.name)
    );
    do {
      const nameIndex = nextDefaultIndex[parentID] ?? 1;
      nextDefaultIndex[parentID] = nameIndex + 1;
      name = makeDefaultLabelmapName(baseName, nameIndex);
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
  function removeLabelmap(id: string) {
    if (!(id in dataIndex)) return;
    const { parentImage } = labelmapMetadata[id];
    removeFromArray(orderByParent.value[parentImage], id);
    delete dataIndex[id];
    delete labelmapMetadata[id];
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

    const labelmapStore = useLabelmapStore();
    const labelmapImage = toLabelMap(childImage);
    const { order, byKey } = normalizeForStore(
      structuredClone(DEFAULT_LABELMAP_SEGMENTS),
      'value'
    );
    labelmapStore.addLabelmap(labelmapImage, {
      name: imageStore.metadata[imageID].name,
      parentImage: parentID,
      segments: { order, byValue: byKey },
    });

    imageStore.deleteData(imageID);
  }

  /**
   * Updates a labelmap's metadata
   * @param labelmapID
   * @param metadata
   */
  function updateMetadata(
    labelmapID: string,
    metadata: Partial<LabelMapMetadata>
  ) {
    labelmapMetadata[labelmapID] = {
      ...getMetadata(labelmapID),
      ...metadata,
    };
  }

  /**
   * Creates a new default segment with an unallocated value.
   *
   * The value picked is the smallest unused value greater than 0.
   * @param labelmapID
   */
  function createNewSegment(labelmapID: string): LabelMapSegment {
    const { segments } = getMetadata(labelmapID);

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
   * @param labelmapID
   * @param segment
   */
  function addSegment(labelmapID: string, segment?: LabelMapSegment) {
    const metadata = getMetadata(labelmapID);
    const seg = segment ?? createNewSegment(labelmapID);
    if (!validateSegment(labelmapID, seg)) throw new Error('Invalid segment');
    metadata.segments.byValue[seg.value] = seg;
    metadata.segments.order.push(seg.value);
  }

  /**
   * Updates a segment's properties.
   *
   * Does not allow updating the segment value.
   * @param labelmapID
   * @param segmentValue
   * @param segmentUpdate
   */
  function updateSegment(
    labelmapID: string,
    segmentValue: number,
    segmentUpdate: Partial<Omit<LabelMapSegment, 'value'>>
  ) {
    const metadata = getMetadata(labelmapID);
    const segment = getSegment(labelmapID, segmentValue);
    metadata.segments.byValue[segmentValue] = {
      ...segment,
      ...segmentUpdate,
    };
  }

  /**
   * Deletes a segment from a labelmap.
   * @param labelmapID
   * @param segmentValue
   */
  function deleteSegment(labelmapID: string, segmentValue: number) {
    const { segments } = getMetadata(labelmapID);
    removeFromArray(segments.order, segmentValue);
    delete segments.byValue[segmentValue];

    dataIndex[labelmapID].replaceLabelValue(
      segmentValue,
      LABELMAP_BACKGROUND_VALUE
    );
  }

  /**
   * Serializes the store's state.
   */
  async function serialize(state: StateFile) {
    const { zip } = state;

    // orderByParent is implicity preserved based on
    // the order of serialized entries.

    const parents = Object.keys(orderByParent.value);
    const serialized = parents.flatMap((parentID) => {
      const labelmapIDs = orderByParent.value[parentID];
      return labelmapIDs.map((id) => {
        const metadata = labelmapMetadata[id];
        return {
          id,
          path: `labels/${id}.vti`,
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
        const vtiImage = await vtiWriter(dataIndex[id]);
        zip.file(path, vtiImage);
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

    const labelmapIDMap: Record<string, string> = {};

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

        const labelmapImage = toLabelMap(
          (await vtiReader(file)) as vtkImageData
        );
        const id = useIdStore().nextId();
        dataIndex[id] = labelmapImage;
        this.$proxies.addData(id, labelmapImage);
        return id;
      })
    );

    labelMaps.forEach((labelMap, index) => {
      const { metadata } = labelMap;
      // map parent id to new id
      const parentImage = findImageID(dataIDMap[metadata.parentImage]);
      metadata.parentImage = parentImage;

      const newID = newLabelmapIDs[index];
      labelmapIDMap[labelMap.id] = newID;

      labelmapMetadata[newID] = metadata;
      orderByParent.value[parentImage] ??= [];
      orderByParent.value[parentImage].push(newID);
    });

    return labelmapIDMap;
  }

  // --- sync segments --- //

  const segmentsByLabelmapID = computed(() => {
    return Object.entries(labelmapMetadata).reduce<
      Record<string, LabelMapSegment[]>
    >((acc, [id, metadata]) => {
      const {
        segments: { order, byValue },
      } = metadata;
      const segments = order.map((value) => byValue[value]);
      return { ...acc, [id]: segments };
    }, {});
  });

  watch(
    segmentsByLabelmapID,
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
      orderByParent.value[parentID].forEach((labelmapID) => {
        removeLabelmap(labelmapID);
      });
    });
  });

  // --- api --- //

  return {
    dataIndex,
    labelmapMetadata,
    orderByParent,
    segmentsByLabelmapID,
    addLabelmap,
    newLabelmapFromImage,
    removeLabelmap,
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
