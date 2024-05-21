import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import {
  getColorFunctionRangeFromPreset,
  getOpacityFunctionFromPreset,
} from '@/src/utils/vtk-helpers';
import { DEFAULT_PRESET_BY_MODALITY, DEFAULT_PRESET } from '@/src/config';
import { ColorTransferFunction } from '@/src/types/views';
import { defineStore } from 'pinia';
import { reactive } from 'vue';
import {
  DoubleKeyRecord,
  deleteSecondKey,
  getDoubleKeyRecord,
  patchDoubleKeyRecord,
} from '@/src/utils/doubleKeyRecord';
import { DeepPartial, Maybe } from '@/src/types';
import { identity } from '@/src/utils';
import { isDicomImage } from '@/src/utils/dataSelection';
import { createViewConfigSerializer } from './common';
import { ViewConfig } from '../../io/state-file/schema';
import { VolumeColorConfig } from './types';
import { useDICOMStore } from '../datasets-dicom';
import { useImageStore } from '../datasets-images';

export const DEFAULT_AMBIENT = 0.2;
export const DEFAULT_DIFFUSE = 0.7;
export const DEFAULT_SPECULAR = 0.3;
export const DEFAULT_EDGE_GRADIENT = 0.2;
export const DEFAULT_SAMPLING_DISTANCE = 0.2;

function getPresetFromImageModality(imageID: string) {
  const dicomStore = useDICOMStore();
  if (isDicomImage(imageID)) {
    const volKey = imageID;
    const { Modality } = dicomStore.volumeInfo[volKey];
    if (Modality in DEFAULT_PRESET_BY_MODALITY) {
      return DEFAULT_PRESET_BY_MODALITY[Modality];
    }
  }
  return DEFAULT_PRESET;
}

/**
 * Gets partial color and opacity function configs from a preset.
 * @param preset
 * @returns
 */
function getColorAndOpacityFuncsFromPreset(preset: string) {
  const ctFunc: Partial<ColorTransferFunction> = {
    preset,
  };

  const ctRange = getColorFunctionRangeFromPreset(preset);
  if (ctRange) {
    ctFunc.mappingRange = ctRange;
  }

  const opFunc = getOpacityFunctionFromPreset(preset);

  return { colorFunc: ctFunc, opacityFunc: opFunc };
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
    useVolumetricScatteringBlending: false,
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
  const configs = reactive<DoubleKeyRecord<VolumeColorConfig>>(
    Object.create(null)
  );
  const defaultConfigs = reactive<
    Record<string, DeepPartial<VolumeColorConfig>>
  >(Object.create(null));

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
    if (!image) throw new Error('Invalid imageID');

    const imageDataRange = image.getPointData().getScalars().getRange();
    const { colorFunc, opacityFunc } =
      getColorAndOpacityFuncsFromPreset(preset);
    colorFunc.mappingRange ||= imageDataRange;
    opacityFunc.mappingRange = imageDataRange;

    updateColorTransferFunction(viewID, imageID, colorFunc);
    updateOpacityFunction(viewID, imageID, opacityFunc);
  };

  const resetToDefaultColoring = (
    viewID: string,
    dataID: string,
    image: vtkImageData
  ) => {
    const defaults = defaultConfigs[dataID];
    const scalars = image.getPointData().getScalars();

    updateColorBy(viewID, dataID, {
      arrayName: defaults?.colorBy?.arrayName ?? scalars.getName(),
      location: defaults?.colorBy?.location ?? 'pointData',
    });
    setColorPreset(
      viewID,
      dataID,
      defaults?.transferFunction?.preset ?? getPresetFromImageModality(dataID)
    );
  };

  /**
   * Sets the view config defaults for a dataset.
   * @param dataID
   * @param defaults
   */
  const setDefaults = (
    dataID: string,
    defaults: DeepPartial<VolumeColorConfig>
  ) => {
    defaultConfigs[dataID] = defaults;
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
    setDefaults,
    setColorPreset,
    removeView,
    removeData,
    serialize,
    deserialize,
  };
});

export default useVolumeColoringStore;
