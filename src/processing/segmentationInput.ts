import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { planLabelmapExport } from '@/src/segmentation/io/composition';

export function planSegmentationInput(imageId: string, multiple: boolean) {
  const segmentationStore = useSegmentationStore();
  const base = {
    parentId: imageId,
    name: segmentationStore.segmentationName(imageId),
  };
  if (multiple) {
    const { parts } = planLabelmapExport(imageId);
    return { ...base, parts, warning: undefined };
  }
  const registry = useSegmentStore().segments;
  // An unpainted definition has no mask to prioritize, so packing falls back
  // to the first mask in this image's segment order.
  const selected = registry.selectedSegmentId(imageId);
  const preferred =
    selected && segmentationStore.maskOf(selected) ? selected : undefined;
  const [first, ...rest] = planLabelmapExport(imageId, preferred).parts;
  const omitted = rest
    .flat()
    .map((mask) => registry.appearanceOf(mask.segmentId).displayName);
  const advice = preferred
    ? ''
    : ' Select a segment on this image to prioritize it.';
  return {
    ...base,
    parts: [first],
    warning: omitted.length
      ? `This input accepts one labelmap. Omitted whole segments: ${omitted.join(', ')}.${advice}`
      : undefined,
  };
}
