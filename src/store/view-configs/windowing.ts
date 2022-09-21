import { useDoubleRecord } from '@/src/composables/useDoubleRecord';
import { removeDataFromConfig, removeViewFromConfig } from './common';

export interface WindowLevelConfig {
  width: number;
  level: number;
  min: number; // data range min
  max: number; // data range max
}

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

  return {
    removeView: removeViewFromConfig(windowLevelConfigs),
    removeData: removeDataFromConfig(windowLevelConfigs),
    actions: {
      getWindowingConfig,
      updateWindowingConfig,
      resetWindowLevel,
    },
  };
};
