import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import {
  getColorFunctionRangeFromPreset,
  getOpacityFunctionFromPreset,
} from '@/src/utils/vtk-helpers';
import { DEFAULT_PRESET_BY_MODALITY, DEFAULT_PRESET } from '@/src/config';
import type { OpacityFunction } from '@/src/types/views';
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
import { useImageCacheStore } from '@/src/store/image-cache';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import type { ProgressiveImage } from '@/src/core/progressiveImage';
import {
  getConventionalVolumePreset,
  getDefaultVolumePreset,
} from '@/src/utils/defaultVolumePreset';
import {
  ADAPTIVE_VOLUME_LIGHTING,
  getAdaptiveVolumePreset,
  isAdaptiveVolumePreset,
} from '@/src/utils/adaptiveVolumePreset';
import { createViewConfigSerializer } from './common';
import { ViewConfig } from '../../io/state-file/schema';
import { VolumeColorConfig } from './types';
import { useDICOMStore } from '../datasets-dicom';

export const DEFAULT_AMBIENT = 0.2;
export const DEFAULT_DIFFUSE = 0.7;
export const DEFAULT_SPECULAR = 0.3;
export const DEFAULT_EDGE_GRADIENT = 0.2;
export const DEFAULT_SAMPLING_DISTANCE = 0.2;

function getVolumeMetadata(image: ProgressiveImage | undefined) {
  return image instanceof DicomChunkImage && image.getChunks().length
    ? (image.getDicomMetadata() ?? undefined)
    : image?.headerMetadata;
}

function getImageModality(imageID: string) {
  const image = useImageCacheStore().imageById[imageID];
  const nativeModality = useDICOMStore().volumeInfo[imageID]?.Modality;
  return {
    nativeModality,
    metadata: getVolumeMetadata(image),
    fallbackPreset:
      DEFAULT_PRESET_BY_MODALITY[nativeModality ?? ''] ?? DEFAULT_PRESET,
  };
}

function getPresetFromImageModality(imageID: string) {
  const scalars = useImageCacheStore()
    .getVtkImageData(imageID)
    ?.getPointData()
    .getScalars();
  return getDefaultVolumePreset({
    ...getImageModality(imageID),
    numberOfComponents: scalars?.getNumberOfComponents(),
    scalarRange: scalars?.getRange(),
  });
}

type ColorAndOpacity = Pick<
  VolumeColorConfig,
  'transferFunction' | 'opacityFunction'
>;

function getConventionalColorAndOpacity(
  preset: string,
  imageRange: readonly [number, number]
): ColorAndOpacity {
  return {
    transferFunction: {
      preset,
      mappingRange: getColorFunctionRangeFromPreset(preset) ?? [...imageRange],
    },
    opacityFunction: {
      ...getOpacityFunctionFromPreset(preset),
      mappingRange: [...imageRange],
    },
  };
}

function getColorAndOpacityFromPreset(
  image: vtkImageData,
  preset: string
): ColorAndOpacity | null {
  return isAdaptiveVolumePreset(preset)
    ? getAdaptiveVolumePreset(image, preset)
    : getConventionalColorAndOpacity(
        preset,
        image.getPointData().getScalars().getRange()
      );
}

function getProvisionalScalarRange(image: vtkImageData) {
  const range = image.getPointData().getScalars().getRange();
  const [min, max] = range;
  if (min !== max) return range;
  if (min === 0) return undefined;
  // Constant decoded pixels still share the volume with unloaded zero voxels.
  return [Math.min(0, min), Math.max(0, max)] as const;
}

function equalMappingRanges(
  left: readonly [number, number],
  right: readonly [number, number]
) {
  const span = Math.max(
    Math.abs(left[1] - left[0]),
    Math.abs(right[1] - right[0])
  );
  // Intensity units and offsets vary; only the span sets meaningful precision.
  const tolerance = Number.isFinite(span) ? span * 1e-10 : 0;
  return left.every(
    (value, index) =>
      value === right[index] ||
      (Number.isFinite(value) &&
        Number.isFinite(right[index]) &&
        Math.abs(value - right[index]) <= tolerance)
  );
}

function equalControlValues(
  left: Array<number | string>,
  right: Array<number | string>
) {
  return (
    left.length === right.length &&
    left.every((value, index) => {
      const other = right[index];
      if (value === other) return true;
      if (typeof value !== 'number' || typeof other !== 'number') return false;
      // Slider shift/width arithmetic can introduce insignificant roundoff.
      const tolerance = 1e-10 * Math.max(1, Math.abs(value), Math.abs(other));
      return (
        Number.isFinite(value) &&
        Number.isFinite(other) &&
        Math.abs(value - other) <= tolerance
      );
    })
  );
}

function getOpacityControlValues(opacity: OpacityFunction) {
  switch (opacity.mode) {
    case vtkPiecewiseFunctionProxy.Mode.Points:
      return [opacity.preset, opacity.shift, opacity.shiftAlpha];
    case vtkPiecewiseFunctionProxy.Mode.Gaussians:
      return opacity.gaussians.flatMap(
        ({ position, width, height, xBias, yBias }) => [
          position,
          width,
          height,
          xBias,
          yBias,
        ]
      );
    case vtkPiecewiseFunctionProxy.Mode.Nodes:
      return opacity.nodes.flatMap(({ x, y, midpoint, sharpness }) => [
        x,
        y,
        midpoint,
        sharpness,
      ]);
  }
}

function equalColorAndOpacity(left: ColorAndOpacity, right: ColorAndOpacity) {
  return (
    left.transferFunction.preset === right.transferFunction.preset &&
    equalMappingRanges(
      left.transferFunction.mappingRange,
      right.transferFunction.mappingRange
    ) &&
    left.opacityFunction.mode === right.opacityFunction.mode &&
    equalMappingRanges(
      left.opacityFunction.mappingRange,
      right.opacityFunction.mappingRange
    ) &&
    equalControlValues(
      getOpacityControlValues(left.opacityFunction),
      getOpacityControlValues(right.opacityFunction)
    )
  );
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

  const getDefaultColorPreset = (imageID: string) =>
    defaultConfigs[imageID]?.transferFunction?.preset ??
    getPresetFromImageModality(imageID);

  // Streaming appearances stay outside configs so completed data still selects
  // the automatic default and only deliberate settings are saved or restored.
  const getProvisionalColoring = (imageID: Maybe<string>) => {
    if (!imageID) return undefined;
    const cache = useImageCacheStore();
    const image = cache.imageById[imageID];
    const imageData = cache.getVtkImageData(imageID);
    if (!imageData || !image || image.isLoaded()) return undefined;

    const range = getProvisionalScalarRange(imageData);
    if (!range) return undefined;

    const configuredPreset = defaultConfigs[imageID]?.transferFunction?.preset;
    const preset =
      configuredPreset && !isAdaptiveVolumePreset(configuredPreset)
        ? configuredPreset
        : getConventionalVolumePreset(getImageModality(imageID));
    return {
      ...defaultVolumeColorConfig(),
      ...getConventionalColorAndOpacity(preset, range),
    };
  };

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
    const imageCacheStore = useImageCacheStore();
    const image = imageCacheStore.getVtkImageData(imageID);
    if (!image) throw new Error('Invalid imageID');

    const adaptive = isAdaptiveVolumePreset(preset);
    if (adaptive && !imageCacheStore.imageById[imageID]?.isLoaded()) return;
    const coloring = getColorAndOpacityFromPreset(image, preset);
    if (!coloring) return;

    const current = getConfig(viewID, imageID) ?? defaultVolumeColorConfig();
    const cvr =
      adaptive && !isAdaptiveVolumePreset(current.transferFunction.preset)
        ? { ...current.cvr, ...ADAPTIVE_VOLUME_LIGHTING }
        : current.cvr;
    updateConfig(viewID, imageID, { ...coloring, cvr });
  };

  const isColorAndOpacityDefault = (
    viewID: Maybe<string>,
    imageID: Maybe<string>
  ) => {
    const current = getConfig(viewID, imageID);
    if (!current || !imageID) return false;
    const imageCacheStore = useImageCacheStore();
    if (!imageCacheStore.imageById[imageID]?.isLoaded()) return false;
    const image = imageCacheStore.getVtkImageData(imageID);
    if (!image) return false;
    const baseline = getColorAndOpacityFromPreset(
      image,
      current.transferFunction.preset
    );
    return baseline !== null && equalColorAndOpacity(current, baseline);
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
    setColorPreset(viewID, dataID, getDefaultColorPreset(dataID));
  };

  const resetColorAndOpacity = (viewID: string, imageID: string) => {
    const preset = getConfig(viewID, imageID)?.transferFunction.preset;
    if (!preset) return;
    if (!useImageCacheStore().imageById[imageID]?.isLoaded()) return;
    setColorPreset(viewID, imageID, preset);
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
    getDefaultColorPreset,
    getProvisionalColoring,
    resetColorAndOpacity,
    isColorAndOpacityDefault,
    setDefaults,
    setColorPreset,
    removeView,
    removeData,
    serialize,
    deserialize,
  };
});

export default useVolumeColoringStore;
