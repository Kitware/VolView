import { useDoubleRecord } from '@/src/composables/useDoubleRecord';
import { ColorTransferFunction, OpacityFunction } from '@/src/types/views';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import { removeDataFromConfig, removeViewFromConfig } from './common';

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
    ambient: 0,
    diffuse: 0,
    specular: 0,
  },
});

export const setupVolumeColorConfig = () => {
  // (viewID, dataID) -> VolumeColorConfig
  const volumeColorConfigs = useDoubleRecord<VolumeColorConfig>();

  const getVolumeColorConfig = (viewID: string, dataID: string) =>
    volumeColorConfigs.get(viewID, dataID);

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

  const updateVolumeCVRParameters = (
    viewID: string,
    dataID: string,
    cvr: Partial<CVRConfig>
  ) => {
    if (volumeColorConfigs.has(viewID, dataID)) {
      const config = volumeColorConfigs.get(viewID, dataID)!;
      const cvrConfig = {
        ...config.cvr,
        ...cvr,
      };
      updateVolumeColorConfig(viewID, dataID, { cvr: cvrConfig });
    }
  };

  return {
    removeView: removeViewFromConfig(volumeColorConfigs),
    removeData: removeDataFromConfig(volumeColorConfigs),
    actions: {
      getVolumeColorConfig,
      updateVolumeColorConfig,
      updateVolumeCVRParameters,
    },
  };
};
