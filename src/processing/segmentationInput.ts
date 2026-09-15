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
  // The selection is shared across images, so it can name a segment this image
  // holds no mask for. Packing then starts from the first mask in registry
  // order instead, and the advice to select a segment has to say where.
  const selected = registry.selectedSegmentId.value;
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
