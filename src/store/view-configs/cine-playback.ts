import { defineStore } from 'pinia';
import { reactive } from 'vue';
import { Maybe } from '@/src/types';
import { clampValue } from '@/src/utils';
import {
  DoubleKeyRecord,
  deleteSecondKey,
  getDoubleKeyRecord,
  patchDoubleKeyRecord,
} from '@/src/utils/doubleKeyRecord';
import { getCineImage } from '@/src/core/cine/isCineImage';
import { createViewConfigSerializer } from '@/src/store/view-configs/common';
import type { StateFile, ViewConfig } from '@/src/io/state-file/schema';
import type { CinePlaybackViewConfig } from '@/src/store/view-configs/types';

export const MIN_CINE_FPS = 1;
export const MAX_CINE_FPS = 120;
export const DEFAULT_CINE_FPS = 24;

export type CinePlaybackConfig = {
  playing: boolean;
  fps: number;
  frame: number;
};

export function clampCineFps(value: string | number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return clampValue(Math.round(parsed), MIN_CINE_FPS, MAX_CINE_FPS);
}

export function defaultCinePlaybackConfig(
  frameTimeMs?: Maybe<number>
): CinePlaybackConfig {
  const fps =
    frameTimeMs && frameTimeMs > 0
      ? Math.round(1000 / frameTimeMs)
      : DEFAULT_CINE_FPS;

  return {
    playing: false,
    fps: clampValue(fps, MIN_CINE_FPS, MAX_CINE_FPS),
    frame: 0,
  };
}

export const useCinePlaybackStore = defineStore('cinePlayback', () => {
  const configs = reactive<DoubleKeyRecord<CinePlaybackConfig>>({});

  const getConfig = (viewID: Maybe<string>, dataID: Maybe<string>) => {
    const frameTimeMs = getCineImage(dataID)?.header.frameTimeMs;
    return {
      ...defaultCinePlaybackConfig(frameTimeMs),
      ...getDoubleKeyRecord(configs, viewID, dataID),
    };
  };

  // Hot path: playback fires at FPS rate, scrub fires per scroll tick. Detect
  // no-op writes before materializing the merged config.
  const updateConfig = (
    viewID: string,
    dataID: string,
    patch: Partial<CinePlaybackConfig>
  ) => {
    const stored = getDoubleKeyRecord(configs, viewID, dataID);
    const nextFps =
      patch.fps === undefined
        ? undefined
        : (clampCineFps(patch.fps) ?? undefined);

    if (stored) {
      const playingSame =
        patch.playing === undefined || patch.playing === stored.playing;
      const fpsSame = nextFps === undefined || nextFps === stored.fps;
      const frameSame =
        patch.frame === undefined || patch.frame === stored.frame;
      if (playingSame && fpsSame && frameSame) return;
    }

    const current = stored ?? getConfig(viewID, dataID);
    patchDoubleKeyRecord(configs, viewID, dataID, {
      ...current,
      ...patch,
      fps: nextFps ?? current.fps,
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
    }
  };

  const serialize = (stateFile: StateFile) => {
    const frameConfigs: DoubleKeyRecord<CinePlaybackViewConfig> = {};
    Object.entries(configs).forEach(([viewID, byDataID]) => {
      frameConfigs[viewID] = {};
      Object.entries(byDataID).forEach(([dataID, config]) => {
        frameConfigs[viewID][dataID] = { frame: config.frame };
      });
    });
    createViewConfigSerializer(frameConfigs, 'cinePlayback')(stateFile);
  };

  const deserialize = (viewID: string, config: Record<string, ViewConfig>) => {
    Object.entries(config).forEach(([dataID, viewConfig]) => {
      if (viewConfig.cinePlayback) {
        updateConfig(viewID, dataID, { frame: viewConfig.cinePlayback.frame });
      }
    });
  };

  return {
    configs,
    getConfig,
    updateConfig,
    removeView,
    removeData,
    serialize,
    deserialize,
  };
});

export default useCinePlaybackStore;
