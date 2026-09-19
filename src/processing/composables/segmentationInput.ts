import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { planLabelmapExport } from '@/src/segmentation/io/composition';
import type { TaskFormModel } from '@/src/processing/engine/formModel';

export const acceptsMultipleLabelmaps = (
  model: TaskFormModel,
  parameterId: string
) => {
  const field = model.fields.find(({ id }) => id === parameterId);
  return field?.kind === 'sourceRef' && field.multiple === true;
};

export function planSegmentationInput(
  segmentationId: string,
  multiple: boolean
) {
  const segmentationStore = useSegmentationStore();
  const segmentation = segmentationStore.segmentations[segmentationId];
  if (!segmentation) throw new Error('No such segmentation');
  const registry = useSegmentStore().segments;
  const { parentImageId } = segmentation;
  // The selection is shared across images, so it can name a segment this image
  // holds no mask for. Packing then starts from the first mask in registry
  // order instead, and the advice to select a segment has to say where.
  const selected = registry.selectedSegmentId.value;
  const preferred =
    selected && segmentationStore.maskFor(parentImageId, selected)
      ? selected
      : undefined;
  const plan = planLabelmapExport(
    parentImageId,
    multiple ? undefined : preferred
  );
  const parts = multiple ? plan.parts : plan.parts.slice(0, 1);
  const omitted = multiple
    ? []
    : plan.parts
        .slice(1)
        .flat()
        .map(
          (mask) =>
            registry.getSegment(mask.segmentId)?.name ?? 'Unnamed segment'
        );
  const advice = preferred
    ? ''
    : ' Select a segment on this image to prioritize it.';
  return {
    parentId: parentImageId,
    name: segmentation.name,
    parts,
    warning: omitted.length
      ? `This input accepts one labelmap. Omitted whole segments: ${omitted.join(', ')}.${advice}`
      : undefined,
  };
}
