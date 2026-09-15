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
  const segmentation = useSegmentationStore().segmentations[segmentationId];
  if (!segmentation) throw new Error('No such segmentation');
  const registry = useSegmentStore().segments;
  const plan = planLabelmapExport(
    segmentation.parentImageId,
    multiple ? undefined : (registry.selectedSegmentId.value ?? undefined)
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
  return {
    parentId: segmentation.parentImageId,
    name: segmentation.name,
    parts,
    warning: omitted.length
      ? `This input accepts one labelmap. Omitted whole segments: ${omitted.join(', ')}. Select a segment to prioritize it.`
      : undefined,
  };
}
