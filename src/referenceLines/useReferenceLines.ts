import { computed, unref, type MaybeRef } from 'vue';
import type { Maybe } from '@/src/types';
import {
  computeEffectiveView,
  volume2DViewsOfImage,
} from '@/src/core/views/effectiveView';
import { useImage } from '@/src/composables/useCurrentImage';
import { useViewStore } from '@/src/store/views';
import useViewSliceStore from '@/src/store/view-configs/slicing';
import { computeReferenceLine, slicePlane } from './geometry';

/**
 * World-space reference line segments to draw in the host view, one per peer
 * slicing view that actually crosses it.
 *
 * Read-only by construction: it never writes a slice config.
 */
export function useReferenceLines(
  viewId: MaybeRef<string>,
  imageId: MaybeRef<Maybe<string>>
) {
  const viewStore = useViewStore();
  const sliceStore = useViewSliceStore();
  const { metadata } = useImage(imageId);

  return computed(() => {
    const hostViewId = unref(viewId);
    const imageID = unref(imageId);
    if (!imageID) return [];

    const hostView = viewStore.getView(hostViewId);
    if (!hostView) return [];

    const hostEffective = computeEffectiveView(hostView, imageID);
    if (hostEffective.kind !== 'volume2D') return [];

    const imageMetadata = metadata.value;
    const hostPlane = slicePlane(
      hostEffective.axis,
      sliceStore.getConfig(hostViewId, imageID).slice,
      imageMetadata
    );

    // Same-axis peers are deliberately kept: they are rejected by the parallel
    // test in `computeReferenceLine`, which is also what will reject
    // near-parallel oblique peers once those become line sources.
    return volume2DViewsOfImage(imageID, viewStore.layoutViews)
      .filter((peer) => peer.viewId !== hostViewId)
      .flatMap((peer) => {
        const peerPlane = slicePlane(
          peer.axis,
          sliceStore.getConfig(peer.viewId, imageID).slice,
          imageMetadata
        );
        const line = computeReferenceLine(hostPlane, peerPlane, imageMetadata);
        return line ? [{ viewId: peer.viewId, line }] : [];
      });
  });
}
