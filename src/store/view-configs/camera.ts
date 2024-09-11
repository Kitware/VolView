import { defineStore } from 'pinia';
import {
  DoubleKeyRecord,
  deleteSecondKey,
  getDoubleKeyRecord,
  patchDoubleKeyRecord,
} from '@/src/utils/doubleKeyRecord';
import { reactive, ref } from 'vue';
import { Maybe } from '@/src/types';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { createViewConfigSerializer } from './common';
import { ViewConfig } from '../../io/state-file/schema';
import { CameraConfig } from './types';
import { useImageStore } from '../datasets-images';

export const useViewCameraStore = defineStore('viewCamera', () => {
  const imageStore = useImageStore();
  const configs = reactive<DoubleKeyRecord<CameraConfig>>({});

  const getConfig = (viewID: Maybe<string>, dataID: Maybe<string>) =>
    getDoubleKeyRecord(configs, viewID, dataID);

  const updateConfig = (
    viewID: string,
    dataID: string,
    patch: Partial<CameraConfig>
  ) => {
    const config = {
      ...getConfig(viewID, dataID),
      ...patch,
    };

    patchDoubleKeyRecord(configs, viewID, dataID, config);
  };
  
  const disableCameraAutoReset = ref(false);

  const toggleCameraAutoReset = () => {
    disableCameraAutoReset.value = !disableCameraAutoReset.value;
  }

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

  const toggleSyncCameras = () => {
    // Synchronize all cameras when toggled
    Object.keys(configs).forEach((viewID) => {
      imageStore.idList.forEach((imageID) => {
        const { syncState } = {
          ...getConfig(viewID, imageID)
        };
        updateConfig(viewID, imageID, { syncState: !syncState });
      });
    });
  }

  const isSync = () => {
    const allSync = Object.keys(configs).every((sc) => Object.keys(configs[sc]).every((c) => configs[sc][c].syncState));

    return allSync;
  }

  const updateSyncConfigs = () => {
    Object.keys(configs).forEach((viewID) => {
      const { currentImageID } = useCurrentImage();
      const config = getConfig(viewID, currentImageID.value);
      imageStore.idList.forEach((imageID) => {
        const { syncState } = {
          ...getConfig(viewID, imageID)
        };

        if (syncState) {
          updateConfig(viewID, imageID, { position: config?.position, focalPoint: config?.focalPoint, parallelScale: config?.parallelScale });
        }
      });
    });
  }

  const serialize = createViewConfigSerializer(configs, 'camera');

  const deserialize = (viewID: string, config: Record<string, ViewConfig>) => {
    Object.entries(config).forEach(([dataID, viewConfig]) => {
      if (viewConfig.camera) {
        updateConfig(viewID, dataID, viewConfig.camera);
      }
    });
  };

  return {
    configs,
    getConfig,
    updateConfig,
    disableCameraAutoReset,
    toggleCameraAutoReset,
    removeView,
    removeData,
    toggleSyncCameras,
    updateSyncConfigs,
    isSync,
    serialize,
    deserialize,
  };
});

export default useViewCameraStore;
