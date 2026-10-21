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
import { resolveLayerColorPreset } from '@/src/vtk/LayerColorPresets';
import { useImageCacheStore } from '@/src/store/image-cache';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import { getConsistentDicomWindowRange } from '@/src/utils/dicomWindowRange';
import { StateFile, ViewConfig } from '../../io/state-file/schema';
import { LayerDisplayConfig, LayersConfig } from './types';
import { useLayersStore } from '../datasets-layers';

export const defaultLayersConfig = (): LayersConfig => ({
  colorBy: {
    arrayName: '',
    location: 'pointData',
  },
  transferFunction: {
    preset: resolveLayerColorPreset(),
    mappingRange: [0, 1],
  },
  opacityFunction: {
    mode: vtkPiecewiseFunctionProxy.Mode.Nodes,
    nodes: [
      { x: 0, y: 1, midpoint: 0.5, sharpness: 0 },
      { x: 1, y: 1, midpoint: 0.5, sharpness: 0 },
    ],
    mappingRange: [0, 1],
  },
  blendConfig: { opacity: 0.3, visibility: true },
  transparentBackground: true,
});

const normalizeConfig = (config: LayersConfig): LayersConfig => ({
  ...config,
  transferFunction: {
    ...config.transferFunction,
    preset: resolveLayerColorPreset(config.transferFunction.preset),
  },
});

const displayFromConfig = (config: LayersConfig): LayerDisplayConfig => ({
  preset: resolveLayerColorPreset(config.transferFunction.preset),
  mappingRange: [...config.transferFunction.mappingRange],
  opacity: config.blendConfig.opacity,
  visibility: config.blendConfig.visibility ?? true,
  transparentBackground: config.transparentBackground ?? true,
});

const applyDisplayPatch = (
  config: LayersConfig,
  display: Partial<LayerDisplayConfig>
): LayersConfig => ({
  ...config,
  transparentBackground:
    display.transparentBackground ?? config.transparentBackground ?? true,
  transferFunction: {
    ...config.transferFunction,
    preset: resolveLayerColorPreset(
      display.preset ?? config.transferFunction.preset
    ),
    mappingRange: [
      ...(display.mappingRange ?? config.transferFunction.mappingRange),
    ],
  },
  blendConfig: {
    ...config.blendConfig,
    opacity: display.opacity ?? config.blendConfig.opacity,
    visibility: display.visibility ?? config.blendConfig.visibility ?? true,
  },
});

export const useLayerColoringStore = defineStore('layerColoring', () => {
  const imageCacheStore = useImageCacheStore();

  const configs = reactive<DoubleKeyRecord<LayersConfig>>({});
  const displayConfigs = reactive<Record<string, LayerDisplayConfig>>({});

  const computeDefaultConfig = (dataID: string): LayersConfig => {
    const defaults = defaultLayersConfig();
    const preset = defaults.transferFunction.preset;

    const image = imageCacheStore.getVtkImageData(dataID);
    if (!image) return defaults;

    const imageDataRange = image.getPointData().getScalars().getRange();

    const layer = useLayersStore().getLayer(dataID);
    const source = layer && imageCacheStore.imageById[layer.selection];
    const isPET =
      source instanceof DicomChunkImage && source.getModality() === 'PT';
    const dicomRange =
      isPET && image.getPointData().getScalars().getNumberOfComponents() === 1
        ? getConsistentDicomWindowRange(
            source.getChunks().map((chunk) => chunk.metadata)
          )
        : undefined;
    const ctRange = getColorFunctionRangeFromPreset(preset);
    const ctFunc: Partial<ColorTransferFunction> = {
      preset,
      mappingRange: dicomRange ?? ctRange ?? imageDataRange,
    };

    const opacityFunction = getOpacityFunctionFromPreset(preset);

    return {
      ...defaults,
      transferFunction: { ...defaults.transferFunction, ...ctFunc },
      blendConfig: {
        ...defaults.blendConfig,
        opacity: isPET ? 0.5 : defaults.blendConfig.opacity,
      },
      opacityFunction:
        opacityFunction.mode === vtkPiecewiseFunctionProxy.Mode.Points
          ? { ...opacityFunction, mappingRange: imageDataRange }
          : defaults.opacityFunction,
    };
  };

  const getDisplayConfig = (dataID: string) => {
    const current = displayConfigs[dataID];
    if (current) {
      const preset = resolveLayerColorPreset(current.preset);
      if (preset !== current.preset) {
        displayConfigs[dataID] = { ...current, preset };
      }
      return displayConfigs[dataID];
    }
    const existing = Object.values(configs).find((view) => view[dataID])?.[
      dataID
    ];
    const display = displayFromConfig(existing ?? computeDefaultConfig(dataID));
    // Loading placeholders must not become the defaults for future views.
    if (existing || imageCacheStore.getVtkImageData(dataID)) {
      displayConfigs[dataID] = display;
      return displayConfigs[dataID];
    }
    return display;
  };

  const getConfig = (viewID: Maybe<string>, dataID: Maybe<string>) => {
    if (!viewID || !dataID) return defaultLayersConfig();
    const config = getDoubleKeyRecord(configs, viewID, dataID);
    if (config) {
      if (
        config.transferFunction.preset !==
        resolveLayerColorPreset(config.transferFunction.preset)
      ) {
        const normalized = normalizeConfig(config);
        patchDoubleKeyRecord(configs, viewID, dataID, normalized);
        return normalized;
      }
      return config;
    }

    const defaultConfig = applyDisplayPatch(
      computeDefaultConfig(dataID),
      getDisplayConfig(dataID)
    );
    if (imageCacheStore.getVtkImageData(dataID)) {
      patchDoubleKeyRecord(configs, viewID, dataID, defaultConfig);
    }
    return defaultConfig;
  };

  const updateConfig = (
    viewID: string,
    dataID: string,
    patch: Partial<LayersConfig>
  ) => {
    const config = normalizeConfig({
      ...defaultLayersConfig(),
      ...getConfig(viewID, dataID),
      ...patch,
    });

    patchDoubleKeyRecord(configs, viewID, dataID, config);
  };

  const updateDisplayConfig = (
    dataID: string,
    patch: Partial<LayerDisplayConfig>
  ) => {
    const current = getDisplayConfig(dataID);
    displayConfigs[dataID] = {
      ...current,
      ...patch,
      preset: resolveLayerColorPreset(patch.preset ?? current.preset),
      visibility: patch.visibility ?? current.visibility ?? true,
      transparentBackground:
        patch.transparentBackground ?? current.transparentBackground ?? true,
      mappingRange: patch.mappingRange
        ? [...patch.mappingRange]
        : current.mappingRange,
    };
    Object.entries(configs).forEach(([viewID, viewConfigs]) => {
      const config = viewConfigs[dataID];
      if (config)
        updateConfig(viewID, dataID, applyDisplayPatch(config, patch));
    });
  };

  const removeView = (viewID: string) => {
    delete configs[viewID];
  };

  const removeData = (dataID: string, viewID?: string) => {
    if (viewID) {
      delete configs[viewID]?.[dataID];
    } else {
      deleteSecondKey(configs, dataID);
      delete displayConfigs[dataID];
    }
  };

  const serialize = ({ manifest }: StateFile) => {
    const dataIDs = new Set((manifest.datasets ?? []).map(({ id }) => id));
    const layerIDs = Object.entries(useLayersStore().parentToLayers).flatMap(
      ([parent, layers]) =>
        dataIDs.has(parent)
          ? layers
              .filter(({ selection }) => dataIDs.has(selection))
              .map(({ id }) => id)
          : []
    );

    manifest.layerDisplay = {};
    layerIDs.forEach((layerID) => {
      const display = displayConfigs[layerID];
      if (display) {
        manifest.layerDisplay![layerID] = {
          ...display,
          mappingRange: [...display.mappingRange],
        };
      }
    });

    Object.values(manifest.viewByID ?? {}).forEach((view) => {
      layerIDs.forEach((layerID) => {
        const config = configs[view.id]?.[layerID];
        if (!config) return;
        view.config ??= {};
        view.config[layerID] ??= {};
        view.config[layerID].layers = config;
      });
    });
  };

  const deserializeDisplayConfigs = (
    saved: Record<string, LayerDisplayConfig>,
    dataIDMap: Record<string, string>
  ) => {
    Object.entries(saved).forEach(([dataID, display]) => {
      const mappedID = dataIDMap[dataID];
      if (mappedID) {
        updateDisplayConfig(mappedID, display);
      }
    });
  };

  const deserialize = (viewID: string, config: Record<string, ViewConfig>) => {
    Object.entries(config).forEach(([dataID, viewConfig]) => {
      if (viewConfig.layers) {
        displayConfigs[dataID] ??= displayFromConfig(viewConfig.layers);
        updateConfig(viewID, dataID, viewConfig.layers);
      }
    });
  };

  return {
    configs,
    displayConfigs,
    getDisplayConfig,
    updateDisplayConfig,
    getConfig,
    removeView,
    removeData,
    serialize,
    deserialize,
    deserializeDisplayConfigs,
  };
});

export default useLayerColoringStore;
