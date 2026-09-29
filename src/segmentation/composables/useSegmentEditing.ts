import { computed, reactive, ref } from 'vue';

import type { SegmentRegistry } from '@/src/segmentation/segmentRegistry';
import type { Maybe } from '@/src/types';
import { cssColorToRGBA } from '@/src/segmentation/color';
import { cleanUndefined } from '@/src/utils';
import { deleteUnlockedSegment } from '@/src/segmentation/deleteSegment';

/**
 * The segment edit dialog: one editor, one set of fields, one place that
 * decides what a name may be. Reads every field through the registry's
 * resolver, so an unset one shows the app default.
 */
export function useSegmentEditing(registry: SegmentRegistry) {
  const editingSegmentId = ref<Maybe<string>>(undefined);
  const editDialog = ref(false);
  const editState = reactive({
    name: '',
    color: '',
    fillOpacity: 1,
    outlineOpacity: 1,
    strokeWidth: 1,
  });
  // A commit states only what changed, so an untouched field keeps following
  // the app default.
  let opened = { ...editState };

  const editingSegment = computed(() =>
    editingSegmentId.value
      ? registry.getSegment(editingSegmentId.value)
      : undefined
  );

  const editingName = computed(
    () => registry.appearanceOf(editingSegmentId.value).name
  );

  const invalidNames = computed(
    () =>
      new Set(
        registry.segmentList.value
          .filter((segment) => segment.id !== editingSegmentId.value)
          .map((segment) => registry.appearanceOf(segment.id).name.trim())
      )
  );

  function startEditing(id: string) {
    const appearance = registry.appearanceOf(id);
    if (!registry.getSegment(id) || appearance.locked) return;
    editingSegmentId.value = id;
    editDialog.value = true;
    editState.name = appearance.name;
    editState.color = appearance.cssColor;
    editState.fillOpacity = appearance.fillOpacity;
    editState.outlineOpacity = appearance.outlineOpacity;
    editState.strokeWidth = appearance.strokeWidth;
    opened = { ...editState };
  }

  function stopEditing(commit: boolean) {
    const id = editingSegmentId.value;
    if (
      id &&
      commit &&
      registry.getSegment(id) &&
      !registry.appearanceOf(id).locked
    ) {
      const changed = <K extends keyof typeof editState>(key: K) =>
        editState[key] === opened[key] ? undefined : editState[key];
      const color = changed('color');
      registry.updateSegment(
        id,
        cleanUndefined({
          name: changed('name')?.trim(),
          color: color === undefined ? undefined : cssColorToRGBA(color),
          fillOpacity: changed('fillOpacity'),
          outlineOpacity: changed('outlineOpacity'),
          strokeWidth: changed('strokeWidth'),
        })
      );
    }
    editingSegmentId.value = undefined;
    editDialog.value = false;
  }

  // Deleting a segment takes its masks on every image and its shapes with it.
  function deleteEditingSegment() {
    const id = editingSegmentId.value;
    if (id) deleteUnlockedSegment(registry, id);
    stopEditing(false);
  }

  return {
    editDialog,
    editState,
    editingSegment,
    editingName,
    editingLocked: computed(
      () => registry.appearanceOf(editingSegmentId.value).locked
    ),
    invalidNames,
    startEditing,
    stopEditing,
    deleteEditingSegment,
  };
}
