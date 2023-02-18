import { MaybeRef } from '@vueuse/core';
import { useDoubleRecord } from '@/src/composables/useDoubleRecord';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import {
  getColorFunctionRangeFromPreset,
  getOpacityFunctionFromPreset,
  getOpacityRangeFromPreset,
} from '@/src/utils/vtk-helpers';
import { DEFAULT_PRESET_BY_MODALITY } from '@/src/config';
import { ColorTransferFunction } from '@/src/types/views';
import {
  removeDataFromConfig,
  removeViewFromConfig,
  serializeViewConfig,
} from './common';
import { DEFAULT_PRESET } from '../../vtk/ColorMaps';
import { StateFile, ViewConfig } from '../../io/state-file/schema';
import { LayersConfig } from './types';
import { useDICOMStore } from '../datasets-dicom';
import { useImageStore } from '../datasets-images';

function getPresetFromVolume(imageID: string) {
  const dicomStore = useDICOMStore();
  if (imageID in dicomStore.imageIDToVolumeKey) {
    const volKey = dicomStore.imageIDToVolumeKey[imageID];
    const { pipeline, Modality } = dicomStore.volumeInfo[volKey];
    if (pipeline.kind === 'pt-ct') return '2hot';
    if (Modality in DEFAULT_PRESET_BY_MODALITY) {
      return DEFAULT_PRESET_BY_MODALITY[Modality];
    }
  }
  return DEFAULT_PRESET;
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
  opacityFunction: {
    mode: vtkPiecewiseFunctionProxy.Mode.Gaussians,
    gaussians: [],
    mappingRange: [0, 1],
  },
  blendConfig: { opacity: 0.6 },
});

export const setupLayersConfig = () => {
  // (viewID, dataID) -> LayersConfig
  const layersConfigs = useDoubleRecord<LayersConfig>();

  const getConfig = (viewID: string, dataID: string) =>
    layersConfigs.get(viewID, dataID);

  const getComputedConfig = (
    viewID: MaybeRef<string | null>,
    dataID: MaybeRef<string | null>
  ) => layersConfigs.getComputed(viewID, dataID);

  const updateConfig = (
    viewID: string,
    dataID: string,
    update: Partial<LayersConfig>
  ) => {
    const config = {
      ...defaultLayersConfig(),
      ...layersConfigs.get(viewID, dataID),
      ...update,
    };
    layersConfigs.set(viewID, dataID, config);
  };

  const createUpdateFunc = <K extends keyof LayersConfig>(
    key: K,
    validator: (config: LayersConfig[K]) => LayersConfig[K] = (i) => i
  ) => {
    return (
      viewID: string,
      dataID: string,
      update: Partial<LayersConfig[K]>
    ) => {
      const config = layersConfigs.get(viewID, dataID) ?? defaultLayersConfig();
      const updatedConfig = validator({
        ...config[key],
        ...update,
      });
      updateConfig(viewID, dataID, { [key]: updatedConfig });
    };
  };

  const updateColorBy = createUpdateFunc('colorBy');
  const updateTransferFunction = createUpdateFunc('transferFunction');
  const updateOpacityFunction = createUpdateFunc('opacityFunction');
  const updateBlendConfig = createUpdateFunc('blendConfig');

  const setColorPreset = (viewID: string, imageID: string, preset: string) => {
    const imageStore = useImageStore();
    const image = imageStore.dataIndex[imageID];
    if (!image) return;
    const imageDataRange = image.getPointData().getScalars().getRange();

    const ctRange = getColorFunctionRangeFromPreset(preset);
    const ctFunc: Partial<ColorTransferFunction> = {
      preset,
      mappingRange: ctRange || imageDataRange,
    };
    updateTransferFunction(viewID, imageID, ctFunc);

    const opFunc = getOpacityFunctionFromPreset(preset);
    const opRange = getOpacityRangeFromPreset(preset);
    opFunc.mappingRange = opRange || imageDataRange;
    updateOpacityFunction(viewID, imageID, opFunc);
  };

  const resetToDefault = (
    viewID: string,
    dataID: string,
    image: vtkImageData
  ) => {
    const scalars = image.getPointData().getScalars();

    updateColorBy(viewID, dataID, {
      arrayName: scalars.getName() + dataID,
      location: 'pointData',
    });
    setColorPreset(viewID, dataID, getPresetFromVolume(dataID));
  };

  const serialize = (stateFile: StateFile) => {
    serializeViewConfig(stateFile, getConfig, 'layers');
  };

  const deserialize = (viewID: string, config: Record<string, ViewConfig>) => {
    Object.entries(config).forEach(([dataID, viewConfig]) => {
      if (viewConfig.layers) {
        layersConfigs.set(viewID, dataID, viewConfig.layers);
      }
    });
  };

  return {
    removeView: removeViewFromConfig(layersConfigs),
    removeData: removeDataFromConfig(layersConfigs),
    serialize,
    deserialize,
    actions: {
      getConfig,
      getComputedConfig,
      updateConfig,
      updateColorBy,
      updateTransferFunction,
      updateOpacityFunction,
      updateBlendConfig,
      resetToDefault,
      setColorPreset,
    },
  };
};
