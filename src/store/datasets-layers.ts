import { ref, set } from '@vue/composition-api';
import vtkITKHelper from '@kitware/vtk.js/Common/DataModel/ITKHelper';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkBoundingBox from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import { defineStore } from 'pinia';
import { useImageStore } from '@/src/store/datasets-images';
import { resample } from '../io/resample/resample';
import { useDICOMStore } from './datasets-dicom';
import {
  DataSelection,
  makeDICOMSelection,
  makeImageSelection,
  useImageID,
} from './datasets';
import { useErrorMessage } from '../composables/useErrorMessage';

// differ from Image/Volume IDs with a branded type
type DataSelectionKey = string & { __type: 'DataSelectionKey' };
export type LayerID = string & { __type: 'LayerID' };

export type Layer = {
  selection: DataSelection;
  image: vtkImageData;
  id: LayerID;
};

const compareDataSelection = (a: DataSelection, b: DataSelection) => {
  if (a.type === 'dicom' && b.type === 'dicom')
    return a.volumeKey === b.volumeKey;
  if (a.type === 'image' && b.type === 'image') return a.dataID === b.dataID;
  return false;
};

const toDataSelectionKey = (selection: DataSelection) => {
  const id =
    selection.type === 'dicom' ? selection.volumeKey : selection.dataID;
  return `${selection.type}::${id}` as DataSelectionKey;
};

const toDataSelectionFromKey = (key: DataSelectionKey) => {
  const [type, id] = key.split('::');
  if (type === 'dicom') return makeDICOMSelection(id);
  if (type === 'image') return makeImageSelection(id);

  throw new Error('Unknown DataSelection key');
};

const useImage = async (selection: DataSelection) => {
  const images = useImageStore();
  const dicoms = useDICOMStore();
  if (selection.type === 'dicom') {
    // ensure image data exists
    await useErrorMessage('Failed to build volume', () =>
      dicoms.buildVolume(selection.volumeKey)
    );
  }
  return images.dataIndex[useImageID(selection)!];
};

export const useLayersStore = defineStore('layer', () => {
  type _This = ReturnType<typeof useLayersStore>;

  const parentToLayers = ref<Record<DataSelectionKey, Layer[]>>({});

  async function _addLayer(
    this: _This,
    parent: DataSelection | null | undefined,
    source: DataSelection
  ) {
    if (!parent) {
      console.warn('Tried to addLayer without parent data selection');
      return;
    }
    const [parentImage, sourceImage] = await Promise.all(
      [parent, source].map(useImage)
    );

    if (
      !vtkBoundingBox.intersects(
        parentImage.getBounds(),
        sourceImage.getBounds()
      )
    )
      throw new Error(
        'Image bounds do not intersect, so no overlap in physical space'
      );

    const itkImage = await resample(
      vtkITKHelper.convertVtkToItkImage(parentImage),
      vtkITKHelper.convertVtkToItkImage(sourceImage)
    );
    const image = vtkITKHelper.convertItkToVtkImage(itkImage);

    const parentKey = toDataSelectionKey(parent);
    const id = `${parentKey}::${toDataSelectionKey(source)}`;
    set(this.parentToLayers, parentKey, [
      ...(this.parentToLayers[parentKey] ?? []),
      { selection: source, image, id } as Layer,
    ]);

    this.$proxies.addData(id, image);
  }

  async function addLayer(
    this: _This,
    parent: DataSelection | null | undefined,
    source: DataSelection
  ) {
    return useErrorMessage('Failed to build layer', () =>
      this._addLayer(parent, source)
    );
  }

  function deleteLayer(
    this: _This,
    parent: DataSelection | null | undefined,
    source: DataSelection
  ) {
    if (!parent) {
      console.warn('Tried to deleteLayer without parent data selection');
      return;
    }

    const parentKey = toDataSelectionKey(parent);
    const layers = this.parentToLayers[parentKey] ?? [];

    const layerToDelete = layers.find(({ selection }) =>
      compareDataSelection(selection, source)
    );
    if (!layerToDelete) return;

    set(
      this.parentToLayers,
      parentKey,
      layers.filter((layer) => layer !== layerToDelete)
    );

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

  return {
    parentToLayers,
    _addLayer,
    addLayer,
    deleteLayer,
    getLayers,
    getLayer,
  };
});
