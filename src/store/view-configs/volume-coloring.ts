import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import {
  getColorFunctionRangeFromPreset,
  getOpacityFunctionFromPreset,
  getRelativePresetRange,
  hasVisibleOpacity,
} from '@/src/utils/vtk-helpers';
import {
  DEFAULT_GRAYSCALE_PRESET,
  DEFAULT_PRESET_BY_MODALITY,
  DEFAULT_PRESET,
} from '@/src/config';
import { defineStore } from 'pinia';
import { getCurrentScope, reactive, watch } from 'vue';
import {
  DoubleKeyRecord,
  deleteSecondKey,
  getDoubleKeyRecord,
  patchDoubleKeyRecord,
} from '@/src/utils/doubleKeyRecord';
import { DeepPartial, Maybe } from '@/src/types';
import { identity } from '@/src/utils';
import { isDicomImage } from '@/src/utils/dataSelection';
import { getDeclaredModality } from '@/src/utils/declaredModality';
import { looksLikeHounsfieldRange } from '@/src/utils/hounsfieldRange';
import { useImageCacheStore } from '@/src/store/image-cache';
import { createViewConfigSerializer } from './common';
import { ViewConfig } from '../../io/state-file/schema';
import { VolumeColorConfig } from './types';
import { useDICOMStore } from '../datasets-dicom';

export const DEFAULT_AMBIENT = 0.2;
export const DEFAULT_DIFFUSE = 0.7;
export const DEFAULT_SPECULAR = 0.3;
export const DEFAULT_EDGE_GRADIENT = 0.2;
export const DEFAULT_SAMPLING_DISTANCE = 0.2;

function getDeclaredPreset(imageID: string) {
  const dicomModality = isDicomImage(imageID)
    ? useDICOMStore().volumeInfo[imageID]?.Modality
    : undefined;
  const modality = getDeclaredModality(
    dicomModality,
    useImageCacheStore().imageById[imageID]?.headerMetadata
  );
  return DEFAULT_PRESET_BY_MODALITY[modality];
}

/**
 * Checks against the scalar range need every voxel, so a streaming image keeps
 * its declared preset, or the CT guess, for good.
 */
function getDefaultPreset(imageID: string, image: vtkImageData) {
  const declared = getDeclaredPreset(imageID);
  const scalars = image.getPointData().getScalars();
  if (
    scalars.getNumberOfComponents() !== 1 ||
    !useImageCacheStore().imageById[imageID]?.isLoaded()
  )
    return declared ?? DEFAULT_PRESET;
  const range = scalars.getRange();
  const fits = declared
    ? hasVisibleOpacity(declared, range)
    : looksLikeHounsfieldRange(range);
  return fits ? (declared ?? DEFAULT_PRESET) : DEFAULT_GRAYSCALE_PRESET;
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

  const storeScope = getCurrentScope();
  const pendingRefits = new Map<string, () => void>();

  // A range fitted to a streaming image's partial voxels is refit once it loads.
  const refitWhenLoaded = (viewID: string, imageID: string, preset: string) => {
    const key = JSON.stringify([viewID, imageID]);
    pendingRefits.get(key)?.();
    const imageCacheStore = useImageCacheStore();
    const stop = storeScope!.run(() =>
      watch(
        () => imageCacheStore.imageById[imageID]?.isLoaded() ?? true,
        (settled) => {
          if (!settled) return;
          stop?.();
          pendingRefits.delete(key);
          if (
            imageCacheStore.getVtkImageData(imageID) &&
            getConfig(viewID, imageID)?.transferFunction.preset === preset
          )
            setColorPreset(viewID, imageID, preset);
        }
      )
    );
    if (stop) pendingRefits.set(key, stop);
  };

  const setColorPreset = (viewID: string, imageID: string, preset: string) => {
    const imageCacheStore = useImageCacheStore();
    const image = imageCacheStore.getVtkImageData(imageID);
    if (!image) throw new Error('Invalid imageID');

    const presetRange = getColorFunctionRangeFromPreset(preset);
    // Absolute opacity points stay in scalar units, edited over the data range.
    const opacityRange = presetRange
      ? image.getPointData().getScalars().getRange()
      : getRelativePresetRange(image);

    updateColorTransferFunction(viewID, imageID, {
      preset,
      mappingRange: presetRange ?? opacityRange,
    });
    updateOpacityFunction(viewID, imageID, {
      ...getOpacityFunctionFromPreset(preset),
      mappingRange: opacityRange,
    });
    if (!presetRange && !imageCacheStore.imageById[imageID]?.isLoaded())
      refitWhenLoaded(viewID, imageID, preset);
  };

  const getInitialPreset = (dataID: string, image: vtkImageData) =>
    defaultConfigs[dataID]?.transferFunction?.preset ??
    getDefaultPreset(dataID, image);

  const resetToDefaultColoring = (
    viewID: string,
    dataID: string,
    image: vtkImageData
  ) => {
    const defaults = defaultConfigs[dataID];
    const preset = getInitialPreset(dataID, image);
    const scalars = image.getPointData().getScalars();

    updateColorBy(viewID, dataID, {
      arrayName: defaults?.colorBy?.arrayName ?? scalars.getName(),
      location: defaults?.colorBy?.location ?? 'pointData',
    });
    setColorPreset(viewID, dataID, preset);
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
