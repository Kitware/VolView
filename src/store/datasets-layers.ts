import { computed, ref, set, del } from '@vue/composition-api';
import vtkITKHelper from '@kitware/vtk.js/Common/DataModel/ITKHelper';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { defineStore } from 'pinia';
import { useImageStore } from '@/src/store/datasets-images';
import { resample } from '../io/resample/resample';
import { useDICOMStore } from './datasets-dicom';

export type LayerID = string & { __type: 'LayerID' }; // branded type

export const useLayerStore = defineStore('layer', () => {
  type _This = ReturnType<typeof useLayerStore>;

  const layers = ref<Record<LayerID, vtkImageData>>({});
  const parentToLayers = ref<Record<string, LayerID[]>>({}); // ImageID to LayerID[]
  const layerIDToImageID = ref<Record<LayerID, string>>({}); // LayerID to source ImageID

  async function addLayer(
    this: _This,
    parentImageID: string,
    sourceImageID: string
  ) {
    const imageStore = useImageStore();
    const parentData = imageStore.dataIndex[parentImageID];
    if (!parentData) {
      throw new Error('No image data for parentImageID');
    }
    const sourceData = imageStore.dataIndex[sourceImageID];
    if (!sourceData) {
      throw new Error('No image data for sourceImageID');
    }

    const image = await resample(
      vtkITKHelper.convertVtkToItkImage(parentData),
      vtkITKHelper.convertVtkToItkImage(sourceData)
    );
    const vtkImage = vtkITKHelper.convertItkToVtkImage(image);

    const id = this.$id.nextID();

    set(this.layers, id, vtkImage);
    set(this.parentToLayers, parentImageID, [
      ...(this.parentToLayers[parentImageID] ?? []),
      id,
    ]);

    set(this.layerIDToImageID, id, sourceImageID);

    this.$proxies.addData(id, vtkImage);

    return id;
  }

  function deleteLayer(this: _This, id: LayerID) {
    del(this.layers, id);

    const parentImageID = Object.entries(this.parentToLayers).find(
      ([, layerIDs]) => layerIDs.includes(id)
    )?.[0];
    set(
      this.parentToLayers,
      parentImageID,
      ((parentImageID && this.parentToLayers[parentImageID]) || []).filter(
        (layerID) => layerID !== id
      )
    );

    del(this.layerIDToImageID, id);

    this.$proxies.deleteData(id);
  }

  return { layers, parentToLayers, layerIDToImageID, addLayer, deleteLayer };
});

export const useLayerModality = (layerID: LayerID) =>
  computed(() => {
    const layerStore = useLayerStore();
    const dicomStore = useDICOMStore();
    const imageID = layerStore.layerIDToImageID[layerID];
    const volumeKey = dicomStore.imageIDToVolumeKey[imageID];
    const { Modality = undefined } = dicomStore.volumeInfo[volumeKey];
    return Modality;
  });

export const useLayerVolumeID = (layerID: LayerID) =>
  computed(() => {
    const layerStore = useLayerStore();
    const dicomStore = useDICOMStore();
    const imageID = layerStore.layerIDToImageID[layerID];
    const volumeKey = dicomStore.imageIDToVolumeKey[imageID];
    return volumeKey;
  });

export const useVolumeIDToLayerID = (volumeID: string) =>
  computed<LayerID | undefined>(() => {
    const layerStore = useLayerStore();
    const dicomStore = useDICOMStore();
    const sourceImageID = dicomStore.volumeToImageID[volumeID];
    const layerID = Object.entries(layerStore.layerIDToImageID).find(
      ([, imageID]) => imageID === sourceImageID
    )?.[0];
    return layerID as LayerID | undefined;
  });
