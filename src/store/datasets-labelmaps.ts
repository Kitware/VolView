import { ref } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { defineStore } from 'pinia';
import { useImageStore } from '@/src/store/datasets-images';
import { join, normalize } from '@/src/utils/path';
import { useIdStore } from '@/src/store/id';
import { onImageDeleted } from '@/src/composables/onImageDeleted';
import { removeFromArray } from '@/src/utils';
import vtkLabelMap from '../vtk/LabelMap';
import { LABELMAP_PALETTE } from '../config';
import { StateFile, Manifest } from '../io/state-file/schema';
import { vtiReader, vtiWriter } from '../io/vtk/async';
import { FileEntry } from '../io/types';
import { findImageID, getDataID } from './datasets';

const LabelmapArrayType = Uint8Array;
export type LabelmapArrayType = Uint8Array;

export interface LabelMapMetadata {
  name: string;
  parentImage: string;
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
  labelmap.setColorMap(LABELMAP_PALETTE);

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
  labelmap.setColorMap(LABELMAP_PALETTE);

  return labelmap;
}

export const useLabelmapStore = defineStore('labelmap', () => {
  type _This = ReturnType<typeof useLabelmapStore>;

  const dataIndex = ref<Record<string, vtkLabelMap>>(Object.create(null));
  const labelmapMetadata = ref<Record<string, LabelMapMetadata>>(
    Object.create(null)
  );
  const orderByParent = ref<Record<string, string[]>>(Object.create(null));

  /**
   * Adds a given image + metadata as a labelmap.
   */
  function addLabelmap(
    this: _This,
    labelmap: vtkLabelMap,
    metadata: LabelMapMetadata
  ) {
    const id = useIdStore().nextId();

    dataIndex.value[id] = labelmap;
    labelmapMetadata.value[id] = metadata;
    orderByParent.value[metadata.parentImage] ??= [];
    orderByParent.value[metadata.parentImage].push(id);

    this.$proxies.addData(id, labelmap);

    return id;
  }

  /**
   * Creates a new labelmap entry from a parent/source image.
   */
  function newLabelmapFromImage(this: _This, parentID: string) {
    const imageStore = useImageStore();
    const imageData = imageStore.dataIndex[parentID];
    if (!imageData) {
      return null;
    }

    const labelmap = createLabelmapFromImage(imageData);

    return addLabelmap.call(this, labelmap, {
      name: 'Unnamed Labelmap',
      parentImage: parentID,
    });
  }

  /**
   * Deletes a labelmap.
   */
  function removeLabelmap(id: string) {
    if (!(id in dataIndex.value)) return;
    const { parentImage } = labelmapMetadata.value[id];
    removeFromArray(orderByParent.value[parentImage], id);
    delete dataIndex.value[id];
    delete labelmapMetadata.value[id];
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
        const metadata = labelmapMetadata.value[id];
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
        const vtiImage = await vtiWriter(dataIndex.value[id]);
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
        dataIndex.value[id] = labelmapImage;
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

      labelmapMetadata.value[newID] = metadata;
      orderByParent.value[parentImage] ??= [];
      orderByParent.value[parentImage].push(newID);
    });

    return labelmapIDMap;
  }

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
    addLabelmap,
    newLabelmapFromImage,
    removeLabelmap,
    serialize,
    deserialize,
  };
});
