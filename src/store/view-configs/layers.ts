import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import {
  getColorFunctionRangeFromPreset,
  getOpacityFunctionFromPreset,
} from '@/src/utils/vtk-helpers';
import { ColorTransferFunction } from '@/src/types/views';
import { defineStore } from 'pinia';
import { reactive } from 'vue';
import {
  DoubleKeyRecord,
  deleteSecondKey,
  getDoubleKeyRecord,
  patchDoubleKeyRecord,
} from '@/src/utils/doubleKeyRecord';
import { Maybe } from '@/src/types';
import { identity } from '@/src/utils';
import { LAYER_PRESET_BY_MODALITY, LAYER_PRESET_DEFAULT } from '@/src/config';
import { isDicomImage } from '@/src/utils/dataSelection';
import { createViewConfigSerializer } from './common';
import { ViewConfig } from '../../io/state-file/schema';
import { LayersConfig } from './types';
import { LayerID, useLayersStore } from '../datasets-layers';
import { useDICOMStore } from '../datasets-dicom';

function getPreset(id: LayerID) {
  const layersStore = useLayersStore();
  const layer = layersStore.getLayer(id);
  if (!layer) {
    throw new Error(`Layer ${id} not found`);
  }

  if (isDicomImage(layer.selection)) {
    const dicomStore = useDICOMStore();
    const { Modality = undefined } = dicomStore.volumeInfo[layer.selection];
    return (
      (Modality && LAYER_PRESET_BY_MODALITY[Modality]) || LAYER_PRESET_DEFAULT
    );
  }

  return LAYER_PRESET_DEFAULT;
}

export const defaultLayersConfig = (): LayersConfig => ({
  colorBy: {
    arrayName: '',
    location: 'pointData',
  },
  transferFunction: {
    preset: '',
    mappingRange: [0, 1],
  },
  // opacity function not used in VtkTwoView
  opacityFunction: {
    mode: vtkPiecewiseFunctionProxy.Mode.Gaussians,
    gaussians: [],
    mappingRange: [0, 1],
  },
  blendConfig: { opacity: 0.6 },
});

export const useLayerColoringStore = defineStore('layerColoring', () => {
  const configs = reactive<DoubleKeyRecord<LayersConfig>>({});

  const getConfig = (viewID: Maybe<string>, dataID: Maybe<string>) =>
    getDoubleKeyRecord(configs, viewID, dataID);

  const updateConfig = (
    viewID: string,
    dataID: string,
    patch: Partial<LayersConfig>
  ) => {
    const config = {
      ...defaultLayersConfig(),
      ...getConfig(viewID, dataID),
      ...patch,
    };

    patchDoubleKeyRecord(configs, viewID, dataID, config);
  };

  const createUpdateFunc = <K extends keyof LayersConfig>(
    key: K,
    transform: (config: LayersConfig[K]) => LayersConfig[K] = identity
  ) => {
    return (
      viewID: string,
      dataID: LayerID,
      update: Partial<LayersConfig[K]>
    ) => {
      const config = getConfig(viewID, dataID) ?? defaultLayersConfig();
      const updatedConfig = transform({
        ...config[key],
        ...update,
      });
      updateConfig(viewID, dataID, { [key]: updatedConfig });
    };
  };

  const updateColorBy = createUpdateFunc('colorBy');
  const updateColorTransferFunction = createUpdateFunc('transferFunction');
  const updateOpacityFunction = createUpdateFunc('opacityFunction');
  const updateBlendConfig = createUpdateFunc('blendConfig');

  const setColorPreset = (viewID: string, layerID: LayerID, preset: string) => {
    const layersStore = useLayersStore();
    const image = layersStore.layerImages[layerID];
    if (!image) return;
    const imageDataRange = image.getPointData().getScalars().getRange();

    const ctRange = getColorFunctionRangeFromPreset(preset);
    const ctFunc: Partial<ColorTransferFunction> = {
      preset,
      mappingRange: ctRange || imageDataRange,
    };
    updateColorTransferFunction(viewID, layerID, ctFunc);

    const opFunc = getOpacityFunctionFromPreset(preset);
    opFunc.mappingRange = imageDataRange;
    updateOpacityFunction(viewID, layerID, opFunc);
  };

  const resetColorPreset = (viewID: string, layerID: LayerID) => {
    setColorPreset(viewID, layerID, getPreset(layerID));
  };

  const removeView = (viewID: string) => {
    delete configs[viewID];
  };

  const removeData = (dataID: string, viewID?: string) => {
    if (viewID) {
      delete configs[viewID]?.[dataID];
    } else {
      deleteSecondKey(configs, dataID);
    }
  };

  const serialize = createViewConfigSerializer(configs, 'layers');

  const deserialize = (viewID: string, config: Record<string, ViewConfig>) => {
    Object.entries(config).forEach(([dataID, viewConfig]) => {
      if (viewConfig.layers) {
        updateConfig(viewID, dataID, viewConfig.layers);
      }
    });
  };

  return {
    configs,
    getConfig,
    updateConfig,
    updateColorBy,
    updateColorTransferFunction,
    updateOpacityFunction,
    updateBlendConfig,
    setColorPreset,
    resetColorPreset,
    removeView,
    removeData,
    serialize,
    deserialize,
  };
});

export default useLayerColoringStore;
