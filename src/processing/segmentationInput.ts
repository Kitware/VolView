import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { planLabelmapExport } from '@/src/segmentation/io/composition';

export function planSegmentationInput(
  segmentationId: string,
  multiple: boolean
) {
  const segmentationStore = useSegmentationStore();
  const segmentation = segmentationStore.segmentations[segmentationId];
  if (!segmentation) throw new Error('No such segmentation');
  const { parentImageId } = segmentation;
  const base = { parentId: parentImageId, name: segmentation.name };
  if (multiple) {
    const { parts } = planLabelmapExport(parentImageId);
    return { ...base, parts, warning: undefined };
  }
  const registry = useSegmentStore().segments;
  // An unpainted definition has no mask to prioritize, so packing falls back
  // to the first mask in this image's segment order.
  const selected = registry.selectedSegmentId(parentImageId);
  const preferred =
    selected && segmentationStore.maskFor(parentImageId, selected)
      ? selected
      : undefined;
  const [first, ...rest] = planLabelmapExport(parentImageId, preferred).parts;
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
