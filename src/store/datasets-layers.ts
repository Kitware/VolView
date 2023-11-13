import { ref } from 'vue';
import vtkITKHelper from '@kitware/vtk.js/Common/DataModel/ITKHelper';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkBoundingBox from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import { defineStore } from 'pinia';
import { useImageStore } from '@/src/store/datasets-images';
import { compareImageSpaces } from '@/src/utils/imageSpace';
import { resample } from '../io/resample/resample';
import { useDICOMStore } from './datasets-dicom';
import {
  DataSelection,
  makeDICOMSelection,
  makeImageSelection,
  selectionEquals,
  getImage,
} from './datasets';
import { useErrorMessage } from '../composables/useErrorMessage';
import { Manifest, StateFile } from '../io/state-file/schema';

// differ from Image/Volume IDs with a branded type
type DataSelectionKey = string & { __type: 'DataSelectionKey' };
export type LayerID = string & { __type: 'LayerID' };

export type Layer = {
  selection: DataSelection;
  id: LayerID;
};

const assertNeverDataSelection = (selection: never): never => {
  throw new Error(`Unknown DataSelection: ${selection}`);
};

const getID = (selection: DataSelection) => {
  if (selection.type === 'dicom') return selection.volumeKey;
  if (selection.type === 'image') return selection.dataID;
  return assertNeverDataSelection(selection);
};

const toDataSelectionKey = (selection: DataSelection) => {
  const id = getID(selection);
  return `${selection.type}::${id}` as DataSelectionKey;
};

const toDataSelectionFromKey = (key: DataSelectionKey) => {
  const [type, id] = key.split('::') as [DataSelection['type'], string];

  if (type === 'dicom') return makeDICOMSelection(id);
  if (type === 'image') return makeImageSelection(id);

  return assertNeverDataSelection(type);
};

export const useLayersStore = defineStore('layer', () => {
  type _This = ReturnType<typeof useLayersStore>;

  const parentToLayers = ref<Record<DataSelectionKey, Layer[]>>({});
  const layerImages = ref<Record<LayerID, vtkImageData>>({});

  async function _addLayer(
    this: _This,
    parent: DataSelection,
    source: DataSelection
  ) {
    if (!parent) {
      throw new Error('Tried to addLayer without parent data selection');
    }

    const parentKey = toDataSelectionKey(parent);
    const id = `${parentKey}::${toDataSelectionKey(source)}` as LayerID;
    this.parentToLayers[parentKey] = [
      ...(this.parentToLayers[parentKey] ?? []),
      { selection: source, id } as Layer,
    ];

    const [parentImage, sourceImage] = await Promise.all(
      [parent, source].map(getImage)
    );

    if (
      !vtkBoundingBox.intersects(
        parentImage.getBounds(),
        sourceImage.getBounds()
      )
    ) {
      this.deleteLayer(parent, source);
      throw new Error(
        'Image bounds do not intersect, so no overlap in physical space'
      );
    }

    let image: vtkImageData;
    if (compareImageSpaces(parentImage, sourceImage)) {
      image = sourceImage;
    } else {
      const itkImage = await resample(
        vtkITKHelper.convertVtkToItkImage(parentImage),
        vtkITKHelper.convertVtkToItkImage(sourceImage)
      );
      image = vtkITKHelper.convertItkToVtkImage(itkImage);
    }

    this.$proxies.addData(id, image);

    // calling after adding data to proxy manager delays enabling deletion, thus avoiding error
    this.layerImages[id] = image;
  }

  async function addLayer(
    this: _This,
    parent: DataSelection,
    source: DataSelection
  ) {
    return useErrorMessage('Failed to build layer', () =>
      this._addLayer(parent, source)
    );
  }

  function deleteLayer(
    this: _This,
    parent: DataSelection,
    source: DataSelection
  ) {
    if (!parent) {
      throw new Error('Tried to deleteLayer without parent data selection');
    }

    const parentKey = toDataSelectionKey(parent);
    const layers = this.parentToLayers[parentKey] ?? [];

    const layerToDelete = layers.find(({ selection }) =>
      selectionEquals(selection, source)
    );
    if (!layerToDelete) return;

    this.parentToLayers[parentKey] = layers.filter(
      (layer) => layer !== layerToDelete
    );

    delete this.layerImages[layerToDelete.id];

    // May have errored creating data, so check before delete
    if (this.$proxies.getData(layerToDelete.id))
      this.$proxies.deleteData(layerToDelete.id);
  }

  function getLayers(key: DataSelection | null | undefined) {
    if (!key) return [];
    const dataKey = toDataSelectionKey(key);
    return parentToLayers.value[dataKey] ?? [];
  }

  const getLayer = (layerID: LayerID) =>
    Object.values(parentToLayers.value)
      .flat()
      .flat()
      .find(({ id }) => id === layerID);

  // --- watch for deletion --- //

  const deleteSelection = (deleteKey: DataSelection) => {
    const layerStore = useLayersStore();
    // delete as parent
    layerStore
      .getLayers(deleteKey)
      .forEach(({ selection }) => layerStore.deleteLayer(deleteKey, selection));
    // delete from layer lists
    Object.keys(layerStore.parentToLayers)
      .map((key) => toDataSelectionFromKey(key as DataSelectionKey))
      .forEach((parent) => layerStore.deleteLayer(parent, deleteKey));
  };

  const imageStore = useImageStore();
  imageStore.$onAction(({ name, args }) => {
    if (name !== 'deleteData') {
      return;
    }
    const [id] = args;
    const selection = makeImageSelection(id);
    deleteSelection(selection);
  });

  const dicomStore = useDICOMStore();
  dicomStore.$onAction(({ name, args }) => {
    if (name !== 'deleteVolume') {
      return;
    }
    const [volumeKey] = args;
    const selection = makeDICOMSelection(volumeKey);
    deleteSelection(selection);
  });

  function serialize(this: _This, state: StateFile) {
    state.manifest.parentToLayers = Object.entries(this.parentToLayers).map(
      ([selectionKey, layers]) => ({
        selectionKey,
        sourceSelectionKeys: layers.map(({ selection }) =>
          toDataSelectionKey(selection)
        ),
      })
    );
  }

  function deserialize(
    this: _This,
    manifest: Manifest,
    dataIDMap: Record<string, string>
  ) {
    const remapSelection = (selection: DataSelection) => {
      if (selection.type === 'dicom')
        return makeDICOMSelection(dataIDMap[selection.volumeKey]);
      if (selection.type === 'image')
        return makeImageSelection(dataIDMap[selection.dataID]);

      const _exhaustiveCheck: never = selection;
      throw new Error(`invalid selection type ${_exhaustiveCheck}`);
    };

    const { parentToLayers: parentToLayersSerialized } = manifest;
    parentToLayersSerialized.forEach(
      ({ selectionKey, sourceSelectionKeys }) => {
        const parent = remapSelection(
          toDataSelectionFromKey(selectionKey as DataSelectionKey)
        );
        sourceSelectionKeys.forEach((sourceKey) => {
          const source = remapSelection(
            toDataSelectionFromKey(sourceKey as DataSelectionKey)
          );
          this.addLayer(parent, source);
        });
      }
    );
  }

  return {
    parentToLayers,
    layerImages,
    _addLayer,
    addLayer,
    deleteLayer,
    getLayers,
    getLayer,
    serialize,
    deserialize,
  };
});
