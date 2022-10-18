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
    enabled: false,
    lightFollowsCamera: true,
    useVolumetricScatteringBlending: false,
    volumetricScatteringBlending: 0,
    useLocalAmbientOcclusion: false,
    laoKernelRadius: 0,
    laoKernelSize: 0,
    ambient: DEFAULT_AMBIENT,
    diffuse: DEFAULT_DIFFUSE,
    specular: DEFAULT_SPECULAR,
  },
});

export const setupVolumeColorConfig = () => {
  // (viewID, dataID) -> VolumeColorConfig
  const volumeColorConfigs = useDoubleRecord<VolumeColorConfig>();

  const getVolumeColorConfig = (viewID: string, dataID: string) =>
    volumeColorConfigs.get(viewID, dataID);

  const getComputedVolumeColorConfig = (
    viewID: MaybeRef<string | null>,
    dataID: MaybeRef<string | null>
  ) => volumeColorConfigs.getComputed(viewID, dataID);

  const updateVolumeColorConfig = (
    viewID: string,
    dataID: string,
    update: Partial<VolumeColorConfig>
  ) => {
    const config = {
      ...defaultVolumeColorConfig(),
      ...volumeColorConfigs.get(viewID, dataID),
      ...update,
    };
    volumeColorConfigs.set(viewID, dataID, config);
  };

  const createUpdateFunc = <K extends keyof VolumeColorConfig>(key: K) => {
    return (
      viewID: string,
      dataID: string,
      update: Partial<VolumeColorConfig[K]>
    ) => {
      const config =
        volumeColorConfigs.get(viewID, dataID) ?? defaultVolumeColorConfig();
      const updatedConfig = {
        ...config[key],
        ...update,
      };
      updateVolumeColorConfig(viewID, dataID, { [key]: updatedConfig });
    };
  };

  const updateVolumeColorBy = createUpdateFunc('colorBy');
  const updateVolumeColorTransferFunction =
    createUpdateFunc('transferFunction');
  const updateVolumeOpacityFunction = createUpdateFunc('opacityFunction');
  const updateVolumeCVRParameters = createUpdateFunc('cvr');

  const setVolumeColorPreset = (
    viewID: string,
    imageID: string,
    preset: string
  ) => {
    const imageStore = useImageStore();
    const image = imageStore.dataIndex[imageID];
    if (!image) return;
    const imageDataRange = image.getPointData().getScalars().getRange();

    const ctRange = getColorFunctionRangeFromPreset(preset);
    const ctFunc: Partial<ColorTransferFunction> = {
      preset,
      mappingRange: ctRange || imageDataRange,
    };
    updateVolumeColorTransferFunction(viewID, imageID, ctFunc);

    const opFunc = getOpacityFunctionFromPreset(preset);
    const opRange = getOpacityRangeFromPreset(preset);
    opFunc.mappingRange = opRange || imageDataRange;
    updateVolumeOpacityFunction(viewID, imageID, opFunc);
  };

  const resetToDefaultColoring = (
    viewID: string,
    dataID: string,
    image: vtkImageData
  ) => {
    const scalars = image.getPointData().getScalars();

    updateVolumeColorBy(viewID, dataID, {
      arrayName: scalars.getName(),
      location: 'pointData',
    });
    setVolumeColorPreset(viewID, dataID, getPresetFromImageModality(dataID));
  };

  const serialize = (stateFile: StateFile) => {
    serializeViewConfig(stateFile, getVolumeColorConfig, 'volumeColorConfig');
  };

  const deserialize = (viewID: string, config: Record<string, ViewConfig>) => {
    Object.entries(config).forEach(([dataID, viewConfig]) => {
      if (viewConfig.volumeColorConfig) {
        volumeColorConfigs.set(viewID, dataID, viewConfig.volumeColorConfig);
      }
    });
  };

  return {
    removeView: removeViewFromConfig(volumeColorConfigs),
    removeData: removeDataFromConfig(volumeColorConfigs),
    serialize,
    deserialize,
    actions: {
      getVolumeColorConfig,
      getComputedVolumeColorConfig,
      updateVolumeColorConfig,
      updateVolumeColorBy,
      updateVolumeColorTransferFunction,
      updateVolumeOpacityFunction,
      updateVolumeCVRParameters,
      resetToDefaultColoring,
      setVolumeColorPreset,
    },
  };
};
