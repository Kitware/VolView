import { DoubleKeyRecord } from '@/src/utils/doubleKeyRecord';
import { useDoubleRecord } from '@/src/composables/useDoubleRecord';
import { StateFile, ViewConfig } from '../../io/state-file/schema';
import {
  CameraConfig,
  LayersConfig,
  SliceConfig,
  VolumeColorConfig,
  WindowLevelConfig,
} from './types';
import { ensureDefault } from '../../utils';

class ReturnTypeOfDoubleRecord<T> {
  Return = useDoubleRecord<T>();
}
type ConfigMap = ReturnTypeOfDoubleRecord<any>['Return'];

export const removeViewFromConfig = (config: ConfigMap) => (viewID: string) =>
  config.deleteFirstKey(viewID);

export const removeDataFromConfig =
  (config: ConfigMap) => (dataID: string, viewID?: string) => {
    if (viewID) {
      config.delete(viewID, dataID);
    } else {
      config.deleteSecondKey(dataID);
    }
  };

type SubViewConfig =
  | CameraConfig
  | SliceConfig
  | VolumeColorConfig
  | WindowLevelConfig
  | LayersConfig;

type ViewConfigGetter = (
  viewID: string,
  dataID: string
) => SubViewConfig | undefined;

type ViewConfigStateKey = keyof ViewConfig;

export const serializeViewConfig = <K extends ViewConfigStateKey>(
  stateFile: StateFile,
  configGetter: ViewConfigGetter,
  viewConfigStateKey: K
) => {
  const dataIDs = stateFile.manifest.datasets.map((dataset) => dataset.id);
  const { views } = stateFile.manifest;

  views.forEach((view) => {
    dataIDs.forEach((dataID) => {
      const { config } = view;

      const viewConfig = configGetter(view.id, dataID);
      if (viewConfig !== undefined) {
        const configForData = ensureDefault(dataID, config, {} as ViewConfig);

        configForData[viewConfigStateKey] = viewConfig as ViewConfig[K];
      }
    });
  });
};

export const serializeViewConfigV2 = <
  K extends ViewConfigStateKey,
  V extends ViewConfig[K]
>(
  stateFile: StateFile,
  viewConfigs: DoubleKeyRecord<V>,
  viewConfigStateKey: K
) => {
  const dataIDs = stateFile.manifest.datasets.map((dataset) => dataset.id);
  const { views } = stateFile.manifest;

  views.forEach((view) => {
    dataIDs.forEach((dataID) => {
      const { config } = view;

      const viewConfig = viewConfigs[view.id]?.[dataID];
      if (viewConfig !== undefined) {
        const configForData = ensureDefault(dataID, config, {} as ViewConfig);

        configForData[viewConfigStateKey] = viewConfig as ViewConfig[K];
      }
    });
  });
};

/**
 * @param viewConfigs Expected to be a DoubleKeyRecord. Index is ordered as (ViewID, DataID)
 * @param viewConfigStateKey
 * @returns
 */
export const createViewConfigSerializer = <
  K extends ViewConfigStateKey,
  V extends ViewConfig[K]
>(
  viewConfigs: DoubleKeyRecord<V>,
  viewConfigStateKey: K
) => {
  return (stateFile: StateFile) => {
    serializeViewConfigV2(stateFile, viewConfigs, viewConfigStateKey);
  };
};
