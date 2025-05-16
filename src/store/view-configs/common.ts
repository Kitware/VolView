import { DoubleKeyRecord } from '@/src/utils/doubleKeyRecord';
import { StateFile, ViewConfig } from '../../io/state-file/schema';
import { ensureDefault } from '../../utils';

type ViewConfigStateKey = keyof ViewConfig;

const serializeViewConfig = <
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
    serializeViewConfig(stateFile, viewConfigs, viewConfigStateKey);
  };
};
