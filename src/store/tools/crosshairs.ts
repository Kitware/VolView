import vtkCrosshairsWidget from '@/src/vtk/CrosshairsWidget';
import type { Vector3 } from '@kitware/vtk.js/types';
import { vec3 } from 'gl-matrix';
import { defineStore } from 'pinia';
import { useViewStore } from '@/src/store/views';
import useViewSliceStore from '@/src/store/view-configs/slicing';
import { getImageMetadata } from '@/src/composables/useCurrentImage';
import {
  computeEffectiveView,
  volume2DViewsOfImage,
} from '@/src/core/views/effectiveView';
import { IMAGE_BOX_INFLATION } from '@/src/constants';
import { clampValue } from '@/src/utils';
import type { ImageMetadata } from '@/src/types/image';

/** The world point in `metadata`'s index space, pulled inside the image box. */
function clampToImage(worldPosition: Vector3, metadata: ImageMetadata) {
  const index = vec3.transformMat4(
    vec3.create(),
    worldPosition as vec3,
    metadata.worldToIndex
  );
  metadata.dimensions.forEach((dim, axis) => {
    index[axis] = clampValue(
      index[axis],
      -IMAGE_BOX_INFLATION,
      dim - 1 + IMAGE_BOX_INFLATION
    );
  });
  return index;
}

export const useCrosshairsToolStore = defineStore('crosshairs', () => {
  type _This = ReturnType<typeof useCrosshairsToolStore>;

  const factory = vtkCrosshairsWidget.newInstance();
  const widgetState = factory.getWidgetState();

  const viewSliceStore = useViewSliceStore();
  const viewStore = useViewStore();

  function getWidgetFactory(this: _This) {
    return factory;
  }

  /**
   * Moves the crosshair to a world point picked in `viewId` and slices the
   * views showing that same image to match.
   *
   * The image comes from the view the point was picked in rather than from
   * whichever view happens to be active, so images sharing a layout keep their
   * own slicing.
   *
   * All registered views of the image are sliced, not just those in the
   * current layout, so views hidden by a layout switch come back consistent.
   */
  function setPosition(worldPosition: Vector3, viewId: string) {
    const view = viewStore.getView(viewId);
    const host = view && computeEffectiveView(view, view.dataID);
    if (host?.kind !== 'volume2D') return;

    const imageID = host.renderDataID;
    const metadata = getImageMetadata(imageID);
    const indexPosition = clampToImage(worldPosition, metadata);

    const { lpsOrientation } = metadata;
    volume2DViewsOfImage(imageID, viewStore.getAllViews()).forEach(
      ({ viewId: peerId, axis }) => {
        const slice = Math.round(indexPosition[lpsOrientation[axis]]);
        viewSliceStore.updateConfig(peerId, imageID, { slice });
      }
    );
  }

  function deactivateTool() {
    widgetState.setDragging(false);
  }

  function setDragging(dragging: boolean) {
    widgetState.setDragging(dragging);
  }

  return {
    getWidgetFactory,
    setPosition,
    deactivateTool,
    setDragging,
  };
});
