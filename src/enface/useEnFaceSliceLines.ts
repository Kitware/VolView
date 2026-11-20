import { computed, unref, type MaybeRef } from 'vue';
import type { Maybe } from '@/src/types';
import type { SlabGeometry } from '@/src/core/slab/geometry';
import { useImage } from '@/src/composables/useCurrentImage';
import { volume2DViewsOfImage } from '@/src/core/views/effectiveView';
import { useViewStore } from '@/src/store/views';
import useViewSliceStore from '@/src/store/view-configs/slicing';
import { slicePlane } from '@/src/referenceLines';
import { enFaceSliceLine } from './sliceGeometry';

export function useEnFaceSliceLines(
  viewId: MaybeRef<string>,
  imageId: MaybeRef<Maybe<string>>,
  geometry: MaybeRef<SlabGeometry | null>
) {
  const views = useViewStore();
  const slices = useViewSliceStore();
  const { metadata } = useImage(imageId);
  return computed(() => {
    const imageID = unref(imageId);
    const planeGeometry = unref(geometry);
    if (
      !imageID ||
      !planeGeometry ||
      views.getView(unref(viewId))?.type !== 'EnFace'
    )
      return [];
    return volume2DViewsOfImage(imageID, views.layoutViews).flatMap((peer) => {
      const plane = slicePlane(
        peer.axis,
        slices.getConfig(peer.viewId, imageID).slice,
        metadata.value
      );
      const line = enFaceSliceLine(planeGeometry, plane, metadata.value);
      return line ? [{ id: peer.viewId, ...line }] : [];
    });
  });
}
