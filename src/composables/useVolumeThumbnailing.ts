import { onBeforeUnmount, reactive, ref, watch } from 'vue';
import { Mode as LookupTableProxyMode } from '@kitware/vtk.js/Proxy/Core/LookupTableProxy';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import { createVolumeThumbnailer } from '../core/thumbnailers/volume-thumbnailer';
import { useCameraOrientation } from './useCameraOrientation';
import { useImageStore } from '../store/datasets-images';
import { useCurrentImage } from './useCurrentImage';
import {
  getColorFunctionRangeFromPreset,
  getOpacityRangeFromPreset,
  getRelativePresetRange,
  getShiftedOpacityFromPreset,
  RELATIVE_PRESET_GAUSSIANS,
} from '../utils/vtk-helpers';
import { PresetNameList } from '../vtk/ColorMaps';
import { logError } from '../utils/loggers';

function resetOpacityFunction(
  pwfProxy: vtkPiecewiseFunctionProxy,
  dataRange: [number, number],
  presetName: string
) {
  // reset pwf proxy range
  pwfProxy.setDataRange(...dataRange);

  const points = getShiftedOpacityFromPreset(presetName, dataRange, 0, 0);
  if (points) {
    pwfProxy.setMode(vtkPiecewiseFunctionProxy.Mode.Points);
    pwfProxy.setPoints(points);
  } else {
    pwfProxy.setMode(vtkPiecewiseFunctionProxy.Mode.Gaussians);
    pwfProxy.setGaussians(RELATIVE_PRESET_GAUSSIANS);
  }
}

export function useVolumeThumbnailing(
  thumbnailSize: number,
  createThumbnailer = createVolumeThumbnailer
) {
  const thumbnails = reactive<Record<string, Record<string, string>>>({});
  const thumbnailer = createThumbnailer(thumbnailSize);
  const currentThumbnails = ref<Record<string, string>>({});

  const { currentImageMetadata, currentImageID, currentImageData } =
    useCurrentImage();

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
    const relativeRange = getRelativePresetRange(image);

    async function helper(presetName: string) {
      // bail if a new thumbnail process has started
      if (interruptSentinel !== localSentinel) {
        return;
      }

      // sanity check; did the current image change
      if (imageID !== currentImageID.value) {
        return;
      }

      if (!(imageID in thumbnails)) {
        thumbnails[imageID] = {};
      }

      if (presetName in thumbnails[imageID]) {
        return;
      }

      const opRange = getOpacityRangeFromPreset(presetName);
      resetOpacityFunction(
        thumbnailer.opacityFuncProxy,
        opRange || relativeRange,
        presetName
      );

      thumbnailer.colorTransferFuncProxy.setMode(LookupTableProxyMode.Preset);
      thumbnailer.colorTransferFuncProxy.setPresetName(presetName);
      const ctRange = getColorFunctionRangeFromPreset(presetName);
      thumbnailer.colorTransferFuncProxy.setDataRange(
        ...(ctRange || relativeRange)
      );

      thumbnailer.resetCameraWithOrientation(
        cameraDirVec.value,
        cameraUpVec.value
      );

      const renWin = thumbnailer.scene.getRenderWindow();
      const capture = renWin.captureImages()[0];
      inFlightCaptures.add(capture);
      const imageURL = await capture.finally(() => {
        inFlightCaptures.delete(capture);
      });

      // the capture spans a render, so the cycle may have been superseded
      if (interruptSentinel !== localSentinel) return;
      if (imageID !== currentImageID.value) return;

      if (imageURL) {
        thumbnails[imageID][presetName] = imageURL;
      }
    }

    PresetNameList.reduce(
      (promise, presetName) => promise.then(() => helper(presetName)),
      Promise.resolve()
    ).catch(logError);
  }

  // workaround for computed not properly working on deeply reactive objects
  // in vue 2.
  watch(
    thumbnails,
    () => {
      if (currentImageID.value) {
        currentThumbnails.value = thumbnails[currentImageID.value];
      }
    },
    { deep: true }
  );

  // force thumbnailing to stop
  onBeforeUnmount(() => {
    interruptSentinel = UNMOUNTED;
    Promise.allSettled([...inFlightCaptures])
      .then(() => thumbnailer.delete())
      .catch(logError);
  });

  // trigger thumbnailing
  watch(
    currentImageID,
    (imageID) => {
      if (imageID) {
        doThumbnailing(imageID, currentImageData.value!);
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
        });
      }
    }
  });

  return { currentThumbnails };
}
