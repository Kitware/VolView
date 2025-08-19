import { useCurrentImage } from '@/src/composables/useCurrentImage';
import vtkCrosshairsWidget from '@/src/vtk/CrosshairsWidget';
import type { Bounds, Vector3 } from '@kitware/vtk.js/types';
import { inflate } from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import { computed, ref, unref, watch } from 'vue';
import { vec3 } from 'gl-matrix';
import { defineStore } from 'pinia';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import { Manifest, StateFile } from '@/src/io/state-file/schema';
import { useViewStore } from '@/src/store/views';
import useViewSliceStore from '@/src/store/view-configs/slicing';
import { ViewInfo2D } from '@/src/types/views';
import { get2DViewingVectors } from '@/src/utils/getViewingVectors';

export const useCrosshairsToolStore = defineStore('crosshairs', () => {
  type _This = ReturnType<typeof useCrosshairsToolStore>;

  const factory = vtkCrosshairsWidget.newInstance();
  const widgetState = factory.getWidgetState();
  const handle = widgetState.getHandle();

  const active = ref(false);
  const { currentImageID, currentImageMetadata } = useCurrentImage('global');

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

  const viewSliceStore = useViewSliceStore();
  const viewStore = useViewStore();

  const otherViews = computed(() => {
    return viewStore
      .getViewsForData(unref(currentImageID))
      .filter((view): view is ViewInfo2D => view.type === '2D');
  });

  function getWidgetFactory(this: _This) {
    return factory;
  }

  function setPosition(pos: Vector3) {
    position.value = pos;
  }

  // update the slicing
  watch(imagePosition, (indexPos) => {
    if (!active.value) {
      return;
    }
    const imageID = unref(currentImageID);
    if (!imageID) {
      return;
    }
    const { lpsOrientation } = unref(currentImageMetadata);

    otherViews.value.forEach((view) => {
      const { orientation } = view.options;
      const { viewDirection } = get2DViewingVectors(orientation);
      const axis = getLPSAxisFromDir(viewDirection);
      const index = lpsOrientation[axis];
      const slice = Math.round(indexPos[index]);
      viewSliceStore.updateConfig(view.id, imageID, { slice });
    });
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
    active.value = true;
    return true;
  }

  function deactivateTool() {
    active.value = false;
    widgetState.setDragging(false);
  }

  function setDragging(dragging: boolean) {
    widgetState.setDragging(dragging);
  }

  function serialize(state: StateFile) {
    const { crosshairs } = state.manifest.tools;
    crosshairs.position = position.value;
  }

  function deserialize(manifest: Manifest) {
    const { crosshairs } = manifest.tools;
    position.value = crosshairs.position;
  }

  return {
    getWidgetFactory,
    setPosition,
    position,
    imagePosition,
    activateTool,
    deactivateTool,
    setDragging,
    serialize,
    deserialize,
  };
});
