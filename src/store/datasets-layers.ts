import { reactive } from 'vue';
import vtkBoundingBox from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import { defineStore } from 'pinia';
import { type DataSelection, getImage } from '@/src/utils/dataSelection';
import { Maybe } from '@/src/types';
import { ensureSameSpace } from '@/src/io/resample/resample';
import { useImageCacheStore } from '@/src/store/image-cache';
import { NO_NAME } from '@/src/constants';
import { getLayerId } from '@/src/utils/layers';
import { useLayerColoringStore } from './view-configs/layers';
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
  const pendingLayers = new Map<string, Promise<string | undefined>>();

  async function buildLayerImage(parent: DataSelection, layer: Layer) {
    const { selection: source, id } = layer;
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
      throw new Error(
        'Image bounds do not intersect, so no overlap in physical space'
      );
    }

    const image = await ensureSameSpace(parentImage, sourceImage);
    // Deleted while resampling: caching the image now would leave it unowned.
    if (!parentToLayers[parent]?.includes(layer)) return undefined;

    const name = imageCacheStore.getImageMetadata(source)?.name ?? NO_NAME;
    imageCacheStore.addVTKImageData(image, name, { id });
    return id;
  }

  async function _addLayer(parent: DataSelection, source: DataSelection) {
    if (!parent) {
      throw new Error('Tried to addLayer without parent data selection');
    }

    const id = getLayerId(parent, source);
    const pending = pendingLayers.get(id);
    if (pending) return pending;
    if (parentToLayers[parent]?.some((layer) => layer.id === id)) return id;

    const layer = reactive({ selection: source, id });
    parentToLayers[parent] = [...(parentToLayers[parent] ?? []), layer];
    const task = buildLayerImage(parent, layer);
    pendingLayers.set(id, task);
    try {
      return await task;
    } catch (error) {
      if (parentToLayers[parent]?.includes(layer)) deleteLayer(parent, source);
      throw error;
    } finally {
      if (pendingLayers.get(id) === task) pendingLayers.delete(id);
    }
  }

  async function addLayer(parent: DataSelection, source: DataSelection) {
    return useErrorMessage('Failed to build layer', () =>
      _addLayer(parent, source)
    );
  }

  function deleteLayer(parent: DataSelection, source: DataSelection) {
    if (!parent) {
      throw new Error('Tried to deleteLayer without parent data selection');
    }

    const layers = parentToLayers[parent] ?? [];

    const layerToDelete = layers.find(({ selection }) => selection === source);
    if (!layerToDelete) return;

    parentToLayers[parent] = layers.filter(
      (layer) => layer.id !== layerToDelete.id
    );

    pendingLayers.delete(layerToDelete.id);
    imageCacheStore.removeImage(layerToDelete.id);
    useLayerColoringStore().removeData(layerToDelete.id);
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
      deleteLayer(selectionToRemove, selection)
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
    const parentToLayersSerialized = manifest.parentToLayers;
    if (!parentToLayersSerialized) return;

    const remapSelection = (selection: DataSelection) => {
      return dataIDMap[selection];
    };

    parentToLayersSerialized.forEach(
      ({ selectionKey, sourceSelectionKeys }) => {
        const parent = remapSelection(selectionKey);
        // An image that did not load cannot be a layer parent or a layer
        // source. Handing `addLayer` a missing id only fails later, after it
        // has already written the relationship into `parentToLayers` under
        // that missing id, where the next serialize trips over it.
        if (parent === undefined) return;
        sourceSelectionKeys.forEach((sourceKey) => {
          const source = remapSelection(sourceKey);
          if (source === undefined) return;
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
