import { useCurrentImage } from '@/src/composables/useCurrentImage';
import vtkCrosshairsWidget from '@/src/vtk/CrosshairsWidget';
import { Bounds, Vector3 } from '@kitware/vtk.js/types';
import { inflate } from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import { computed, ref, unref, watch } from '@vue/composition-api';
import { vec3 } from 'gl-matrix';
import { defineStore } from 'pinia';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import { useViewConfigStore } from '../view-configs';
import { useViewStore } from '../views';

export const useCrosshairsToolStore = defineStore('crosshairs', () => {
  type _This = ReturnType<typeof useCrosshairsToolStore>;

  const factory = vtkCrosshairsWidget.newInstance();
  const widgetState = factory.getWidgetState();
  const handle = widgetState.getHandle();

  const active = ref(false);
  const { currentImageID, currentImageMetadata } = useCurrentImage();

  // world-space
  const position = ref<Vector3>([0, 0, 0]);
  // image space
  const imagePosition = computed(() => {
    const out = vec3.create();
    vec3.transformMat4(
      out,
      position.value,
      currentImageMetadata.value.worldToIndex
    );
    return out as Vector3;
  });

  const viewConfigStore = useViewConfigStore();
  const viewStore = useViewStore();

  // only gets views that have a slicing config
  const currentViewIDs = computed(() => {
    const imageID = unref(currentImageID);
    if (imageID) {
      return viewStore.views.filter(
        (viewID) => !!viewConfigStore.getSliceConfig(viewID, imageID)
      );
    }
    return [];
  });

  function getWidgetFactory(this: _This) {
    return factory;
  }

  function setPosition(pos: Vector3) {
    position.value = pos;
  }

  // update the slicing
  watch(imagePosition, (indexPos) => {
    if (active.value) {
      const imageID = unref(currentImageID);
      const { lpsOrientation } = unref(currentImageMetadata);

      if (!imageID) {
        return;
      }

      currentViewIDs.value.forEach((viewID) => {
        const sliceConfig = viewConfigStore.getSliceConfig(viewID, imageID);
        const axis = getLPSAxisFromDir(sliceConfig!.axisDirection);
        const index = lpsOrientation[axis];
        const slice = Math.round(indexPos[index]);
        viewConfigStore.updateSliceConfig(viewID, imageID, { slice });
      });
    }
  });

  // update widget state based on current image
  watch(
    currentImageMetadata,
    (metadata) => {
      widgetState.setIndexToWorld(metadata.indexToWorld);
      widgetState.setWorldToIndex(metadata.worldToIndex);
      const [xDim, yDim, zDim] = metadata.dimensions;
      const imageBounds: Bounds = [0, xDim - 1, 0, yDim - 1, 0, zDim - 1];
      // inflate by 0.5, since the image slice rendering is inflated
      // by 0.5.
      handle.setBounds(inflate(imageBounds, 0.5));
    },
    { immediate: true }
  );

  // update the position
  handle.onModified(() => {
    const origin = handle.getOrigin();
    if (origin) {
      position.value = origin;
    }
  });

  function activateTool() {
    widgetState.setPlaced(false);
    active.value = true;
    return true;
  }

  function deactivateTool() {
    active.value = false;
  }

  return {
    getWidgetFactory,
    setPosition,
    position,
    imagePosition,
    activateTool,
    deactivateTool,
  };
});
