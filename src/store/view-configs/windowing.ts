import { useDoubleRecord } from '@/src/composables/useDoubleRecord';
import {
  removeDataFromConfig,
  removeViewFromConfig,
  serializeViewConfig,
} from './common';
import { StateFile, ViewConfig } from '../../io/state-file/schema';
import { WindowLevelConfig } from './types';

export const defaultWindowLevelConfig = (): WindowLevelConfig => ({
  width: 1,
  level: 0.5,
  min: 0,
  max: 1,
});

export const setupWindowingConfig = () => {
  // (viewID, dataID) -> WindowLevelConfig
  const windowLevelConfigs = useDoubleRecord<WindowLevelConfig>();

  const getWindowingConfig = (viewID: string, dataID: string) =>
    windowLevelConfigs.get(viewID, dataID);

  const updateWindowingConfig = (
    viewID: string,
    dataID: string,
    update: Partial<WindowLevelConfig>
  ) => {
    const config = {
      ...defaultWindowLevelConfig(),
      ...windowLevelConfigs.get(viewID, dataID),
      ...update,
    };
    windowLevelConfigs.set(viewID, dataID, config);
  };

  const resetWindowLevel = (viewID: string, dataID: string) => {
    if (windowLevelConfigs.has(viewID, dataID)) {
      const config = windowLevelConfigs.get(viewID, dataID)!;
      const width = config.max - config.min;
      const level = (config.max + config.min) / 2;
      updateWindowingConfig(viewID, dataID, { width, level });
    }
  };

  const serialize = (stateFile: StateFile) => {
    serializeViewConfig(stateFile, getWindowingConfig, 'window');
  };

  const deserialize = (viewID: string, config: Record<string, ViewConfig>) => {
    Object.entries(config).forEach(([dataID, viewConfig]) => {
      if (viewConfig.window) {
        windowLevelConfigs.set(viewID, dataID, viewConfig.window);
      }
    });
  };

  return {
    removeView: removeViewFromConfig(windowLevelConfigs),
    removeData: removeDataFromConfig(windowLevelConfigs),
    serialize,
    deserialize,
    actions: {
      getWindowingConfig,
      updateWindowingConfig,
      resetWindowLevel,
    },
  };
};
