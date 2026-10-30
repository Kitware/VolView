import { computed, onBeforeUnmount, reactive, watch } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { createVolumeThumbnailer } from '../core/thumbnailers/volume-thumbnailer';
import { useCameraOrientation } from './useCameraOrientation';
import { useImageStore } from '../store/datasets-images';
import { useCurrentImage } from './useCurrentImage';
import { PresetNameList } from '../vtk/ColorMaps';
import { logError } from '../utils/loggers';
import {
  getAdaptiveVolumePresetUnavailableReason,
  isAdaptiveVolumePreset,
} from '@/src/utils/adaptiveVolumePreset';

export function useVolumeThumbnailing(
  thumbnailSize: number,
  createThumbnailer = createVolumeThumbnailer
) {
  const thumbnails = reactive<Record<string, Record<string, string>>>({});
  const thumbnailSources = new Map<
    string,
    { image: vtkImageData; loaded: boolean }
  >();
  const thumbnailer = createThumbnailer(thumbnailSize);

  const {
    currentImageMetadata,
    currentImageID,
    currentImageData,
    currentImage,
  } = useCurrentImage();
  const currentThumbnails = computed(
    () => thumbnails[currentImageID.value ?? ''] ?? {}
  );

  // same as 3D view
  const { cameraDirVec, cameraUpVec } = useCameraOrientation(
    'Posterior',
    'Superior',
    currentImageMetadata
  );

  // used to interrupt a thumbnailing cycle if
  // doThumbnailing is called again
  const UNMOUNTED = Symbol('unmount');
  let interruptSentinel = Symbol('interrupt');

  // captures finish on a timer, so deletion waits for the in-flight ones
  const inFlightCaptures = new Set<Promise<string>>();

  async function doThumbnailing(imageID: string, image: vtkImageData) {
    if (interruptSentinel === UNMOUNTED) return;

    const localSentinel = Symbol('interrupt');
    interruptSentinel = localSentinel;

    thumbnailer.setInputImage(image);
    const adaptiveAvailable = !getAdaptiveVolumePresetUnavailableReason(
      image,
      !!currentImage.value?.isLoaded()
    );
    const cycleIsCurrent = () =>
      interruptSentinel === localSentinel && imageID === currentImageID.value;

    async function helper(presetName: string) {
      if (!cycleIsCurrent()) return;
      if (isAdaptiveVolumePreset(presetName) && !adaptiveAvailable) return;

      if (!(imageID in thumbnails)) {
        thumbnails[imageID] = {};
      }

      if (presetName in thumbnails[imageID]) {
        return;
      }

      thumbnailer.setPreset(presetName);

      thumbnailer.resetCameraWithOrientation(
        cameraDirVec.value,
        cameraUpVec.value
      );

      const renWin = thumbnailer.scene.getRenderWindow();
      renWin.render();
      const capture = renWin.captureImages()[0];
      inFlightCaptures.add(capture);
      const imageURL = await capture.finally(() => {
        inFlightCaptures.delete(capture);
      });

      // the capture spans a render, so the cycle may have been superseded
      if (!cycleIsCurrent()) return;

      if (imageURL) {
        thumbnails[imageID][presetName] = imageURL;
      }
    }

    PresetNameList.reduce(
      (promise, presetName) => promise.then(() => helper(presetName)),
      Promise.resolve()
    ).catch(logError);
  }

  // force thumbnailing to stop
  onBeforeUnmount(() => {
    interruptSentinel = UNMOUNTED;
    Promise.allSettled([...inFlightCaptures])
      .then(() => thumbnailer.delete())
      .catch(logError);
  });

  // trigger thumbnailing
  watch(
    [currentImageID, currentImageData, () => currentImage.value?.isLoaded()],
    ([imageID, image, loaded]) => {
      if (imageID && image) {
        const source = thumbnailSources.get(imageID);
        if (source?.image !== image || source.loaded !== !!loaded) {
          thumbnails[imageID] = {};
          thumbnailSources.set(imageID, { image, loaded: !!loaded });
        }
        doThumbnailing(imageID, image);
      }
    },
    { immediate: true }
  );

  // delete thumbnails if an image is deleted
  const imageStore = useImageStore();
  imageStore.$onAction(({ name, args, after }) => {
    if (name === 'deleteData') {
      const [id] = args as [string];
      if (id in thumbnails) {
        after(() => {
          delete thumbnails[id];
          thumbnailSources.delete(id);
        });
      }
    }
  });

  return { currentThumbnails };
}
