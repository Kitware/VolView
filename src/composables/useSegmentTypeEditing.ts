import { computed, reactive, ref } from 'vue';

import type { SegmentTypeRegistry } from '@/src/store/tools/segmentTypeRegistry';
import type { Maybe } from '@/src/types';
import { cssColorToRGBA } from '@/src/types/segmentation';

/**
 * The edit dialog both type pickers open: one editor, one set of fields, one
 * place that decides what a name may be. Reads every field through the
 * registry's resolver, so an unset one shows the app default.
 */
export function useSegmentTypeEditing(registry: () => SegmentTypeRegistry) {
  const editingTypeId = ref<Maybe<string>>(undefined);
  const editDialog = ref(false);
  const editState = reactive({
    name: '',
    color: '',
    fillOpacity: 1,
    outlineOpacity: 1,
    strokeWidth: 1,
  });

  const editingType = computed(() =>
    editingTypeId.value ? registry().getType(editingTypeId.value) : undefined
  );

  const editingName = computed(
    () => registry().appearanceOf(editingTypeId.value).name
  );

  const invalidNames = computed(
    () =>
      new Set(
        registry()
          .typeList.value.filter((type) => type.id !== editingTypeId.value)
          .map((type) => registry().appearanceOf(type.id).name.trim())
      )
  );

  function startEditing(id: string) {
    if (!registry().getType(id)) return;
    const appearance = registry().appearanceOf(id);
    editingTypeId.value = id;
    editDialog.value = true;
    editState.name = appearance.name;
    editState.color = appearance.cssColor;
    editState.fillOpacity = appearance.fillOpacity;
    editState.outlineOpacity = appearance.outlineOpacity;
    editState.strokeWidth = appearance.strokeWidth;
  }

  function stopEditing(commit: boolean) {
    const id = editingTypeId.value;
    if (id && commit && registry().getType(id)) {
      registry().updateType(id, {
        name: editState.name,
        color: cssColorToRGBA(editState.color),
        fillOpacity: editState.fillOpacity,
        outlineOpacity: editState.outlineOpacity,
        strokeWidth: editState.strokeWidth,
      });
    }
    editingTypeId.value = undefined;
    editDialog.value = false;
  }

  // Deleting a type takes its masks on every image and its shapes with it.
  function deleteEditingType() {
    if (editingTypeId.value) registry().deleteType(editingTypeId.value);
    stopEditing(false);
  }

  return {
    editingTypeId,
    editDialog,
    editState,
    editingType,
    editingName,
    invalidNames,
    startEditing,
    stopEditing,
    deleteEditingType,
  };
}
