import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { ImageMetadata } from '@/src/types/image';
import { LPSAxis } from '@/src/types/lps';
import { ViewTypes } from '@kitware/vtk.js/Widgets/Core/WidgetManager/Constants';
import vtkResliceCursorWidget, {
  ResliceCursorWidgetState,
} from '@kitware/vtk.js/Widgets/Widgets3D/ResliceCursorWidget';
import type { Vector3 } from '@kitware/vtk.js/types';
import { defineStore } from 'pinia';
import { toRaw, watchEffect } from 'vue';

export function mapAxisToViewType(axis: LPSAxis) {
  switch (axis) {
    case 'Coronal':
      return ViewTypes.XZ_PLANE;
    case 'Sagittal':
      return ViewTypes.YZ_PLANE;
    case 'Axial':
      return ViewTypes.XY_PLANE;
    default:
      throw new Error(`Invalid view axis: ${axis}`);
  }
}

function resetReslicePlanes(
  resliceCursorState: ResliceCursorWidgetState,
  imageMetadata: ImageMetadata
) {
  const { Inferior, Anterior, Superior, Left } = toRaw(
    imageMetadata.lpsOrientation
  );
  const planes = {
    [ViewTypes.YZ_PLANE]: {
      normal: Left as Vector3,
      viewUp: Superior as Vector3,
    },
    [ViewTypes.XZ_PLANE]: {
      normal: Anterior as Vector3,
      viewUp: Superior as Vector3,
    },
    [ViewTypes.XY_PLANE]: {
      normal: Inferior as Vector3,
      viewUp: Anterior as Vector3,
    },
  };

  resliceCursorState.setPlanes(planes);
}

function useResliceInit(
  resliceCursor: vtkResliceCursorWidget,
  resliceCursorState: ResliceCursorWidgetState
) {
  const { currentImageData, currentImageMetadata } = useCurrentImage('global');

  watchEffect(() => {
    const image = currentImageData.value;
    if (!image) return;
    resliceCursor.setImage(image);
    // Reset to default plane values before transforming based on current image-data.
    resetReslicePlanes(resliceCursorState, currentImageMetadata.value);
  });
}

const useResliceCursorStore = defineStore('resliceCursor', () => {
  const resliceCursor = vtkResliceCursorWidget.newInstance({
    scaleInPixels: true,
    rotationHandlePosition: 0.75,
  }) as vtkResliceCursorWidget;

  const widgetState =
    resliceCursor.getWidgetState() as ResliceCursorWidgetState;

  useResliceInit(resliceCursor, widgetState);

  return {
    resliceCursor,
    resliceCursorState: widgetState,
    resetReslicePlanes: (imageMetadata: ImageMetadata) => {
      resetReslicePlanes(widgetState, imageMetadata);
    },
  };
});

export default useResliceCursorStore;
