import { MaybeRef } from '@vueuse/core';
import { useDoubleRecord } from '@/src/composables/useDoubleRecord';
import { ColorTransferFunction, OpacityFunction } from '@/src/types/views';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import { getOpacityFunctionFromPreset } from '@/src/utils/vtk-helpers';
import { removeDataFromConfig, removeViewFromConfig } from './common';
import { DEFAULT_PRESET } from '../../vtk/ColorMaps';

export interface CVRConfig {
  enabled: boolean;

  flipLightPosition: boolean;

  useVolumetricScatteringBlending: boolean;
  volumetricScatteringBlending: number;

  useLocalAmbientOcclusion: boolean;
  laoKernelSize: number;
  laoKernelRadius: number;
  ambient: number;
  diffuse: number;
  specular: number;
}

export interface VolumeColorConfig {
  colorBy: {
    arrayName: string;
    location: string;
  };
  transferFunction: ColorTransferFunction;
  opacityFunction: OpacityFunction;
  cvr: CVRConfig;
}

export const DEFAULT_AMBIENT = 0.2;
export const DEFAULT_DIFFUSE = 0.7;
export const DEFAULT_SPECULAR = 0.3;

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
    flipLightPosition: false,
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

  const resetToDefaultColoring = (
    viewID: string,
    dataID: string,
    image: vtkImageData
  ) => {
    const mappingRange = image.getPointData().getScalars().getRange();
    const scalars = image.getPointData().getScalars();

    updateVolumeColorBy(viewID, dataID, {
      arrayName: scalars.getName(),
      location: 'pointData',
    });
    updateVolumeColorTransferFunction(viewID, dataID, {
      preset: DEFAULT_PRESET,
      mappingRange,
    });
    updateVolumeOpacityFunction(viewID, dataID, {
      ...getOpacityFunctionFromPreset(DEFAULT_PRESET),
      mappingRange,
    });
  };

  return {
    removeView: removeViewFromConfig(volumeColorConfigs),
    removeData: removeDataFromConfig(volumeColorConfigs),
    actions: {
      getVolumeColorConfig,
      getComputedVolumeColorConfig,
      updateVolumeColorConfig,
      updateVolumeColorBy,
      updateVolumeColorTransferFunction,
      updateVolumeOpacityFunction,
      updateVolumeCVRParameters,
      resetToDefaultColoring,
    },
  };
};
