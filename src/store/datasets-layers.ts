import { reactive } from 'vue';
import vtkBoundingBox from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import { defineStore } from 'pinia';
import { type DataSelection, getImage } from '@/src/utils/dataSelection';
import { Maybe } from '@/src/types';
import { ensureSameSpace } from '@/src/io/resample/resample';
import { useImageCacheStore } from '@/src/store/image-cache';
import { NO_NAME } from '@/src/constants';
import { useErrorMessage } from '../composables/useErrorMessage';
import { Manifest, StateFile } from '../io/state-file/schema';
import { untilLoaded } from '../composables/untilLoaded';

export type Layer = {
  selection: DataSelection;
  id: string;
};

export const useLayersStore = defineStore('layer', () => {
  const imageCacheStore = useImageCacheStore();

  const parentToLayers = reactive<Record<string, Layer[]>>({});

  async function _addLayer(parent: DataSelection, source: DataSelection) {
    if (!parent) {
      throw new Error('Tried to addLayer without parent data selection');
    }

    const id = `${parent}::${source}` as string;
    parentToLayers[parent] = [
      ...(parentToLayers[parent] ?? []),
      { selection: source, id } as Layer,
    ];

    // ensureSameSpace need final image array to resample, so wait for all chunks
    await untilLoaded(source);

    const [parentImage, sourceImage] = await Promise.all(
      [parent, source].map(getImage)
    );

    if (!sourceImage) {
      throw new Error('Failed to load layer image');
    }
    if (!parentImage) {
      throw new Error('No parent image found');
    }

    if (
      !vtkBoundingBox.intersects(
        parentImage.getBounds(),
        sourceImage.getBounds()
      )
    ) {
      deleteLayer(parent, source);
      throw new Error(
        'Image bounds do not intersect, so no overlap in physical space'
      );
    }

    const image = await ensureSameSpace(parentImage, sourceImage);

    const name = imageCacheStore.getImageMetadata(source)?.name ?? NO_NAME;
    imageCacheStore.addVTKImageData(image, name, { id });
  }

  async function addLayer(parent: DataSelection, source: DataSelection) {
    return useErrorMessage('Failed to build layer', async () => {
      try {
        await _addLayer(parent, source);
      } catch (error) {
        // remove failed layer from parent's layer list
        parentToLayers[parent] = parentToLayers[parent]?.filter(
          ({ selection }) => selection !== source
        );
        throw error;
      }
    });
  }

  function deleteLayer(parent: DataSelection, source: DataSelection) {
    if (!parent) {
      throw new Error('Tried to deleteLayer without parent data selection');
    }

    const layers = parentToLayers[parent] ?? [];

    const layerToDelete = layers.find(({ selection }) => selection === source);
    if (!layerToDelete) return;

    parentToLayers[parent] = layers.filter((layer) => layer !== layerToDelete);

    imageCacheStore.removeImage(layerToDelete.id);
  }

  function getLayers(key: Maybe<DataSelection>) {
    if (!key) return [];
    return parentToLayers[key] ?? [];
  }

  const getLayer = (layerID: string) =>
    Object.values(parentToLayers)
      .flat()
      .flat()
      .find(({ id }) => id === layerID);

  const remove = (selectionToRemove: DataSelection) => {
    // delete as parent
    getLayers(selectionToRemove).forEach(({ selection }) =>
      deleteLayer(selection, selection)
    );
    // delete from layer lists
    Object.keys(parentToLayers).forEach((parent) =>
      deleteLayer(parent, selectionToRemove)
    );
  };

  function serialize(state: StateFile) {
    state.manifest.parentToLayers = Object.entries(parentToLayers).map(
      ([selectionKey, layers]) => ({
        selectionKey,
        sourceSelectionKeys: layers.map(({ selection }) => selection),
      })
    );
  }

  function deserialize(manifest: Manifest, dataIDMap: Record<string, string>) {
    const remapSelection = (selection: DataSelection) => {
      return dataIDMap[selection];
    };

    const { parentToLayers: parentToLayersSerialized } = manifest;
    parentToLayersSerialized.forEach(
      ({ selectionKey, sourceSelectionKeys }) => {
        const parent = remapSelection(selectionKey);
        sourceSelectionKeys.forEach((sourceKey) => {
          const source = remapSelection(sourceKey);
          addLayer(parent, source);
        });
      }
    );
  }

  return {
    parentToLayers,
    _addLayer,
    addLayer,
    deleteLayer,
    remove,
    getLayers,
    getLayer,
    serialize,
    deserialize,
  };
});
