import { computed, MaybeRef } from 'vue';
import { Maybe } from '@/src/types';
import { useEffectiveView } from '@/src/composables/useEffectiveView';
import { useImage } from '@/src/composables/useCurrentImage';
import { useSliceInfo } from '@/src/composables/useSliceInfo';
import { useCineFrame } from '@/src/composables/useCineFrame';
import { useFrameOfReference } from '@/src/composables/useFrameOfReference';
import { get2DViewingVectors } from '@/src/utils/getViewingVectors';
import { viewLocator } from '@/src/core/annotations/locator';

export function useViewLocator(
  viewID: MaybeRef<string>,
  imageID: MaybeRef<Maybe<string>>
) {
  const effective = useEffectiveView(viewID);
  const { metadata } = useImage(imageID);
  const sliceInfo = useSliceInfo(viewID, imageID);
  const { frame } = useCineFrame(viewID, imageID);

  const slice = computed(() => sliceInfo.value?.slice ?? 0);
  const axis = computed(() => sliceInfo.value?.axisName);
  const viewDirection = computed(() =>
    axis.value ? get2DViewingVectors(axis.value).viewDirection : 'Superior'
  );

  const frameOfReference = useFrameOfReference(viewDirection, slice, metadata);

  const locator = computed(() =>
    viewLocator(effective.value, {
      slice: slice.value,
      axis: axis.value ?? undefined,
      frameOfReference: frameOfReference.value,
      frame: frame.value,
    })
  );

  return { locator, frame, slice };
}
