import { computed, reactive, ref } from 'vue';

import type { SegmentRegistry } from '@/src/store/tools/segmentRegistry';
import type { Maybe } from '@/src/types';
import { cssColorToRGBA } from '@/src/types/segmentation';

/**
 * The edit dialog both pickers open: one editor, one set of fields, one place
 * that decides what a name may be. Reads every field through the registry's
 * resolver, so an unset one shows the app default.
 */
export function useSegmentEditing(registry: () => SegmentRegistry) {
  const editingSegmentId = ref<Maybe<string>>(undefined);
  const editDialog = ref(false);
  const editState = reactive({
    name: '',
    color: '',
    fillOpacity: 1,
    outlineOpacity: 1,
    strokeWidth: 1,
  });

  const editingSegment = computed(() =>
    editingSegmentId.value
      ? registry().getSegment(editingSegmentId.value)
      : undefined
  );

  const editingName = computed(
    () => registry().appearanceOf(editingSegmentId.value).name
  );

  const invalidNames = computed(
    () =>
      new Set(
        registry()
          .segmentList.value.filter(
            (type) => type.id !== editingSegmentId.value
          )
          .map((type) => registry().appearanceOf(type.id).name.trim())
      )
  );

  function startEditing(id: string) {
    if (!registry().getSegment(id)) return;
    const appearance = registry().appearanceOf(id);
    editingSegmentId.value = id;
    editDialog.value = true;
    editState.name = appearance.name;
    editState.color = appearance.cssColor;
    editState.fillOpacity = appearance.fillOpacity;
    editState.outlineOpacity = appearance.outlineOpacity;
    editState.strokeWidth = appearance.strokeWidth;
  }

  function stopEditing(commit: boolean) {
    const id = editingSegmentId.value;
    if (id && commit && registry().getSegment(id)) {
      registry().updateSegment(id, {
        name: editState.name,
        color: cssColorToRGBA(editState.color),
        fillOpacity: editState.fillOpacity,
        outlineOpacity: editState.outlineOpacity,
        strokeWidth: editState.strokeWidth,
      });
    }
    editingSegmentId.value = undefined;
    editDialog.value = false;
  }

  // Deleting a segment takes its masks on every image and its shapes with it.
  function deleteEditingSegment() {
    if (editingSegmentId.value)
      registry().deleteSegment(editingSegmentId.value);
    stopEditing(false);
  }

  return {
    editingSegmentId,
    editDialog,
    editState,
    editingSegment,
    editingName,
    invalidNames,
    startEditing,
    stopEditing,
    deleteEditingSegment,
  };
}
