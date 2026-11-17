import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import {
  getColorFunctionRangeFromPreset,
  getOpacityFunctionFromPreset,
} from '@/src/utils/vtk-helpers';
import {
  DEFAULT_GRAYSCALE_PRESET,
  DEFAULT_PRESET_BY_MODALITY,
  DEFAULT_PRESET,
} from '@/src/config';
import { OpacityFunction } from '@/src/types/views';
import { defineStore } from 'pinia';
import { reactive, watch } from 'vue';
import {
  DoubleKeyRecord,
  deleteEntry,
  deleteFirstKey,
  deleteSecondKey,
  forEachEntry,
  getDoubleKeyRecord,
  patchDoubleKeyRecord,
} from '@/src/utils/doubleKeyRecord';
import { DeepPartial, Maybe } from '@/src/types';
import { identity } from '@/src/utils';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useImageStatsStore } from '@/src/store/image-stats';
import { createViewConfigSerializer } from './common';
import { ViewConfig } from '../../io/state-file/schema';
import { VolumeColorConfig } from './types';
import { useDICOMStore } from '../datasets-dicom';

export const DEFAULT_AMBIENT = 0.2;
export const DEFAULT_DIFFUSE = 0.7;
export const DEFAULT_SPECULAR = 0.3;
export const DEFAULT_EDGE_GRADIENT = 0.2;
export const DEFAULT_SAMPLING_DISTANCE = 0.2;

// Air is -1000 HU. Halfway to fat survives smoothing and resampling, while
// MR and normalized intensities stay above it.
const HOUNSFIELD_AIR_LEVEL = -500;

function getDefaultPreset(imageID: string, image: vtkImageData) {
  const modality = useDICOMStore().volumeInfo[imageID]?.Modality;
  const declared = modality && DEFAULT_PRESET_BY_MODALITY[modality];
  if (declared) return declared;
  const scalars = image.getPointData().getScalars();
  if (scalars.getNumberOfComponents() !== 1) return DEFAULT_PRESET;
  return scalars.getRange()[0] <= HOUNSFIELD_AIR_LEVEL
    ? DEFAULT_PRESET
    : DEFAULT_GRAYSCALE_PRESET;
}

const nearlyEqual = (a: readonly number[], b: readonly number[]) =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) <= 1e-6 * Math.abs(b[1] - b[0]);

// The parts of an opacity function the editor writes back.
const opacityEdits = (opacity: OpacityFunction) =>
  JSON.stringify(
    opacity.mode === vtkPiecewiseFunctionProxy.Mode.Points
      ? [opacity.shift, opacity.shiftAlpha]
      : opacity.mode === vtkPiecewiseFunctionProxy.Mode.Gaussians
        ? opacity.gaussians
        : opacity.nodes
  );

const isUnedited = (config: VolumeColorConfig, applied: VolumeColorConfig) =>
  config.transferFunction.preset === applied.transferFunction.preset &&
  nearlyEqual(
    config.transferFunction.mappingRange,
    applied.transferFunction.mappingRange
  ) &&
  opacityEdits(config.opacityFunction) ===
    opacityEdits(applied.opacityFunction);

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

  const imageCacheStore = useImageCacheStore();
  const imageStatsStore = useImageStatsStore();

  const getFitRange = (imageID: string) =>
    imageStatsStore.stats[imageID]?.autoRangeValues?.LowContrast;

  const getDataRange = (imageID: string) =>
    imageCacheStore
      .getVtkImageData(imageID)
      ?.getPointData()
      .getScalars()
      .getRange() ?? [0, 1];

  /** The color range a preset maps onto for an image. */
  const getPresetColorRange = (imageID: string, preset: string) =>
    getColorFunctionRangeFromPreset(preset) ??
    getFitRange(imageID) ??
    getDataRange(imageID);

  // Configs applied before their image's stats existed, as applied.
  const awaitingFit = reactive<DoubleKeyRecord<VolumeColorConfig>>({});

  const setColorPreset = (viewID: string, imageID: string, preset: string) => {
    if (!imageCacheStore.getVtkImageData(imageID))
      throw new Error('Invalid imageID');

    const opacityFunc = getOpacityFunctionFromPreset(preset);
    const relative = !getColorFunctionRangeFromPreset(preset);
    updateColorTransferFunction(viewID, imageID, {
      preset,
      mappingRange: getPresetColorRange(imageID, preset),
    });
    updateOpacityFunction(viewID, imageID, {
      ...opacityFunc,
      mappingRange: getDataRange(imageID),
    });

    deleteEntry(awaitingFit, viewID, imageID);
    const applied = getConfig(viewID, imageID);
    if (relative && !getFitRange(imageID) && applied)
      patchDoubleKeyRecord(awaitingFit, viewID, imageID, applied);
  };

  watch(
    () => {
      const ready: [string, string][] = [];
      forEachEntry(awaitingFit, (viewID, imageID) => {
        if (getFitRange(imageID)) ready.push([viewID, imageID]);
      });
      return ready;
    },
    (ready) =>
      ready.forEach(([viewID, imageID]) => {
        const applied = getDoubleKeyRecord(awaitingFit, viewID, imageID);
        const config = getConfig(viewID, imageID);
        deleteEntry(awaitingFit, viewID, imageID);
        if (applied && config && isUnedited(config, applied))
          setColorPreset(viewID, imageID, applied.transferFunction.preset);
      })
  );

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
      defaults?.transferFunction?.preset ?? getDefaultPreset(dataID, image)
    );
  };

  /**
   * Sets all views' defaults for given dataset.
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
    deleteFirstKey(awaitingFit, viewID);
  };

  const removeData = (dataID: string, viewID?: string) => {
    if (viewID) {
      delete configs[viewID]?.[dataID];
      deleteEntry(awaitingFit, viewID, dataID);
    } else {
      deleteSecondKey(configs, dataID);
      deleteSecondKey(awaitingFit, dataID);
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
    getPresetColorRange,
    getFitRange,
    removeView,
    removeData,
    serialize,
    deserialize,
  };
});

export default useVolumeColoringStore;
