import {
  ToolSelection,
  useToolSelectionStore,
} from '@/src/store/tools/toolSelection';
import { AnnotationToolType } from '@/src/store/tools/types';
import { ToolID } from '@/src/types/annotation-tool';
import { MaybeRef, computed, unref } from 'vue';

export enum MultipleSelectionState {
  None,
  Some,
  All,
}

export const useMultipleToolSelection = (
  collection: MaybeRef<ToolSelection[]>
) => {
  const store = useToolSelectionStore();

  const idToType = computed(() =>
    unref(collection).reduce(
      (acc, { id, type }) => ({ ...acc, [id]: type }),
      {} as Record<ToolID, AnnotationToolType>
    )
  );

  const selected = computed<ToolID[]>({
    get: () => store.selection.map(({ id }) => id),
    set: (newSelection) => {
      store.clearSelection();
      newSelection.forEach((id) => {
        store.addSelection(id, idToType.value[id]);
      });
    },
  });

  const selectionState = computed<MultipleSelectionState>(() => {
    const coll = unref(collection);
    const { length } = unref(coll).filter((tool) => store.isSelected(tool.id));
    if (length === 0) {
      return MultipleSelectionState.None;
    }
    if (length === coll.length) {
      return MultipleSelectionState.All;
    }
    return MultipleSelectionState.Some;
  });

  const selectAll = () => {
    unref(collection).forEach((tool) => store.addSelection(tool.id, tool.type));
  };

  const deselectAll = () => {
    // technically correct solution is collection.forEach(remove),
    // but this will suffice (and is faster).
    store.clearSelection();
  };

  return {
    selectAll,
    deselectAll,
    selected,
    selectionState,
  };
};
