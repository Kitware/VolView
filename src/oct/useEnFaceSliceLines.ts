import { computed, unref, type MaybeRef } from 'vue';
import type { Maybe } from '@/src/types';
import type { ProjectionAxis } from './types';
import { useImage } from '@/src/composables/useCurrentImage';
import { volume2DViewsOfImage } from '@/src/core/views/effectiveView';
import { useViewStore } from '@/src/store/views';
import useViewSliceStore from '@/src/store/view-configs/slicing';
import { slicePlane } from '@/src/referenceLines';
import { enFaceSliceLine } from './sliceGeometry';

export function useEnFaceSliceLines(
  viewId: MaybeRef<string>,
  imageId: MaybeRef<Maybe<string>>,
  axis: MaybeRef<ProjectionAxis>,
  depth: MaybeRef<number>
) {
  const views = useViewStore();
  const slices = useViewSliceStore();
  const { metadata } = useImage(imageId);
  return computed(() => {
    const imageID = unref(imageId);
    if (!imageID || views.getView(unref(viewId))?.type !== 'EnFace') return [];
    return volume2DViewsOfImage(imageID, views.visibleViews)
      .filter((peer) => peer.viewId !== unref(viewId))
      .flatMap((peer) => {
        const plane = slicePlane(
          peer.axis,
          slices.getConfig(peer.viewId, imageID).slice,
          metadata.value
        );
        const line = enFaceSliceLine(
          unref(axis),
          unref(depth),
          plane,
          metadata.value
        );
        return line ? [{ viewId: peer.viewId, ...line }] : [];
      });
  });
}
