import { onBeforeUnmount, reactive, ref, watch } from 'vue';
import { Mode as LookupTableProxyMode } from '@kitware/vtk.js/Proxy/Core/LookupTableProxy';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';
import type { Vector3 } from '@kitware/vtk.js/types';
import { createVolumeThumbnailer } from '../core/thumbnailers/volume-thumbnailer';
import { useCameraOrientation } from './useCameraOrientation';
import { useImageStore } from '../store/datasets-images';
import { useCurrentImage } from './useCurrentImage';
import {
  getColorFunctionRangeFromPreset,
  getOpacityRangeFromPreset,
} from '../utils/vtk-helpers';
import { PresetNameList } from '../vtk/ColorMaps';

function resetOpacityFunction(
  pwfProxy: vtkPiecewiseFunctionProxy,
  dataRange: [number, number],
  presetName: string
) {
  // reset pwf proxy range
  pwfProxy.setDataRange(...dataRange);

  const preset = vtkColorMaps.getPresetByName(presetName);
  if (preset.OpacityPoints) {
    const OpacityPoints = preset.OpacityPoints as number[];
    const points = [];
    for (let i = 0; i < OpacityPoints.length; i += 2) {
      points.push([OpacityPoints[i], OpacityPoints[i + 1]]);
    }

    const [xmin, xmax] = dataRange;
    const width = xmax - xmin;
    const pointsNormalized = points.map(([x, y]) => [(x - xmin) / width, y]);

    pwfProxy.setMode(vtkPiecewiseFunctionProxy.Mode.Points);
    pwfProxy.setPoints(pointsNormalized);
  } else {
    pwfProxy.setMode(vtkPiecewiseFunctionProxy.Mode.Gaussians);
    pwfProxy.setGaussians(vtkPiecewiseFunctionProxy.Defaults.Gaussians);
  }
}

export function useVolumeThumbnailing(thumbnailSize: number) {
  const thumbnails = reactive<Record<string, Record<string, string>>>({});
  const thumbnailer = createVolumeThumbnailer(thumbnailSize);
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
  let interruptSentinel = Symbol('interrupt');

  async function doThumbnailing(imageID: string, image: vtkImageData) {
    const localSentinel = Symbol('interrupt');
    interruptSentinel = localSentinel;

    thumbnailer.setInputImage(image);
    const imageDataRange = image.getPointData().getScalars().getRange();

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
        opRange || imageDataRange,
        presetName
      );

      thumbnailer.colorTransferFuncProxy.setMode(LookupTableProxyMode.Preset);
      thumbnailer.colorTransferFuncProxy.setPresetName(presetName);
      const ctRange = getColorFunctionRangeFromPreset(presetName);
      thumbnailer.colorTransferFuncProxy.setDataRange(
        ...(ctRange || imageDataRange)
      );

      thumbnailer.resetCameraWithOrientation(
        cameraDirVec.value as Vector3,
        cameraUpVec.value as Vector3
      );

      const renWin = thumbnailer.scene.getRenderWindow();
      renWin.render();
      const imageURL = await renWin.captureImages()[0];
      if (imageURL) {
        thumbnails[imageID][presetName] = imageURL;
      }
    }

    PresetNameList.reduce(
      (promise, presetName) => promise.then(() => helper(presetName)),
      Promise.resolve()
    );
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
    interruptSentinel = Symbol('unmount');
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
