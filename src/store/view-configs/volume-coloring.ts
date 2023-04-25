import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import {
  getColorFunctionRangeFromPreset,
  getOpacityFunctionFromPreset,
} from '@/src/utils/vtk-helpers';
import { DEFAULT_PRESET_BY_MODALITY } from '@/src/config';
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
import { createViewConfigSerializer } from './common';
import { DEFAULT_PRESET } from '../../vtk/ColorMaps';
import { ViewConfig } from '../../io/state-file/schema';
import { VolumeColorConfig } from './types';
import { useDICOMStore } from '../datasets-dicom';
import { useImageStore } from '../datasets-images';

export const DEFAULT_AMBIENT = 0.2;
export const DEFAULT_DIFFUSE = 0.7;
export const DEFAULT_SPECULAR = 0.3;

function getPresetFromImageModality(imageID: string) {
  const dicomStore = useDICOMStore();
  if (imageID in dicomStore.imageIDToVolumeKey) {
    const volKey = dicomStore.imageIDToVolumeKey[imageID];
    const { Modality } = dicomStore.volumeInfo[volKey];
    if (Modality in DEFAULT_PRESET_BY_MODALITY) {
      return DEFAULT_PRESET_BY_MODALITY[Modality];
    }
  }
  return DEFAULT_PRESET;
}

export const defaultVolumeColorConfig = (): VolumeColorConfig => ({
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
  cvr: {
    enabled: true,
    lightFollowsCamera: true,
    volumeQuality: 2,
    useVolumetricScatteringBlending: true,
    volumetricScatteringBlending: 0.5,
    useLocalAmbientOcclusion: true,
    laoKernelRadius: 5,
    laoKernelSize: 15,
    ambient: DEFAULT_AMBIENT,
    diffuse: DEFAULT_DIFFUSE,
    specular: DEFAULT_SPECULAR,
  },
});

export const useVolumeColoringStore = defineStore('volumeColoring', () => {
  const configs = reactive<DoubleKeyRecord<VolumeColorConfig>>({});

  const getConfig = (viewID: Maybe<string>, dataID: Maybe<string>) =>
    getDoubleKeyRecord(configs, viewID, dataID);

  const updateConfig = (
    viewID: string,
    dataID: string,
    patch: Partial<VolumeColorConfig>
  ) => {
    const config = {
      ...defaultVolumeColorConfig(),
      ...getConfig(viewID, dataID),
      ...patch,
    };

    patchDoubleKeyRecord(configs, viewID, dataID, config);
  };

  const createUpdateFunc = <K extends keyof VolumeColorConfig>(
    key: K,
    transform: (config: VolumeColorConfig[K]) => VolumeColorConfig[K] = identity
  ) => {
    return (
      viewID: string,
      dataID: string,
      update: Partial<VolumeColorConfig[K]>
    ) => {
      const config = getConfig(viewID, dataID) ?? defaultVolumeColorConfig();
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
  const updateCVRParameters = createUpdateFunc('cvr');

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
    updateColorTransferFunction(viewID, imageID, ctFunc);

    const opFunc = getOpacityFunctionFromPreset(preset);
    opFunc.mappingRange = imageDataRange;
    updateOpacityFunction(viewID, imageID, opFunc);
  };

  const resetToDefaultColoring = (
    viewID: string,
    dataID: string,
    image: vtkImageData
  ) => {
    const scalars = image.getPointData().getScalars();

    updateColorBy(viewID, dataID, {
      arrayName: scalars.getName(),
      location: 'pointData',
    });
    setColorPreset(viewID, dataID, getPresetFromImageModality(dataID));
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

  const serialize = createViewConfigSerializer(configs, 'volumeColorConfig');

  const deserialize = (viewID: string, config: Record<string, ViewConfig>) => {
    Object.entries(config).forEach(([dataID, viewConfig]) => {
      if (viewConfig.volumeColorConfig) {
        updateConfig(viewID, dataID, viewConfig.volumeColorConfig);
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
    updateCVRParameters,
    resetToDefaultColoring,
    setColorPreset,
    removeView,
    removeData,
    serialize,
    deserialize,
  };
});

export default useVolumeColoringStore;
