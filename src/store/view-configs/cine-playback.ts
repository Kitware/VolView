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

export const MIN_CINE_FPS = 1;
export const MAX_CINE_FPS = 120;
export const DEFAULT_CINE_FPS = 24;

export interface CinePlaybackConfig {
  playing: boolean;
  fps: number;
}

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
  };
}

export const useCinePlaybackStore = defineStore('cinePlayback', () => {
  const configs = reactive<DoubleKeyRecord<CinePlaybackConfig>>({});

  const getConfig = (
    viewID: Maybe<string>,
    dataID: Maybe<string>,
    frameTimeMs?: Maybe<number>
  ) => ({
    ...defaultCinePlaybackConfig(frameTimeMs),
    ...getDoubleKeyRecord(configs, viewID, dataID),
  });

  const updateConfig = (
    viewID: string,
    dataID: string,
    patch: Partial<CinePlaybackConfig>,
    frameTimeMs?: Maybe<number>
  ) => {
    const current = getConfig(viewID, dataID, frameTimeMs);
    const fps = patch.fps === undefined ? current.fps : clampCineFps(patch.fps);

    patchDoubleKeyRecord(configs, viewID, dataID, {
      ...current,
      ...patch,
      fps: fps ?? current.fps,
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

  return {
    configs,
    getConfig,
    updateConfig,
    removeView,
    removeData,
  };
});

export default useCinePlaybackStore;
