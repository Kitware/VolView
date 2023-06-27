import { Maybe } from '@/src/types';
import { ref } from 'vue';
import { StoreActions, StoreState } from 'pinia';
import { useIdStore } from '../id';

export type LabelProps<Tool> = Partial<Tool & { labelName: string }>;
export type Labels<Tool> = Record<string, LabelProps<Tool>>;

type LabelID = string;

const labelDefault = { labelName: 'New Label' };

export const useLabels = <Tool>(newLabelDefault: LabelProps<Tool>) => {
  const labels = ref<Labels<Tool>>({});

  // Flag to indicate if addLabel should clear existing labels
  const defaultLabels = ref(true);

  const clearDefaultLabels = () => {
    if (defaultLabels.value) labels.value = {};
    defaultLabels.value = false;
  };

  const activeLabel = ref<string | undefined>();
  const setActiveLabel = (id: string) => {
    activeLabel.value = id;
  };

  const addLabel = (
    props: LabelProps<Tool> = {},
    clearDefault: boolean = true
  ) => {
    if (clearDefault) clearDefaultLabels();

    const id = useIdStore().nextId();
    labels.value[id] = {
      ...labelDefault,
      ...newLabelDefault,
      ...props,
    };

    setActiveLabel(id);
    return id;
  };

  const deleteLabel = (id: LabelID) => {
    if (!(id in labels.value)) throw new Error('Label does not exist');

    delete labels.value[id];
    labels.value = { ...labels.value }; // trigger reactive update for measurement list

    if (id === activeLabel.value) {
      const labelIDs = Object.keys(labels.value);
      if (labelIDs.length !== 0) setActiveLabel(labelIDs[0]);
      else setActiveLabel('');
    }
  };

  /*
   * param newLabels: each key is the label name
   * param clearDefault: if true, clear initial labels, do nothing if initial labels already cleared
   */
  const addLabels = (
    newLabels: Maybe<Labels<Tool>>,
    clearDefault: boolean = true
  ) => {
    Object.entries(newLabels ?? {}).forEach(([labelName, props]) => {
      addLabel({ ...props, labelName }, clearDefault);
    });

    const labelIDs = Object.keys(labels.value);
    if (labelIDs.length !== 0) setActiveLabel(labelIDs[0]);
  };

  const updateLabel = (id: LabelID, patch: LabelProps<Tool>) => {
    if (!(id in labels.value)) throw new Error('Label does not exist');

    labels.value = { ...labels.value, [id]: { ...labels.value[id], ...patch } };
  };

  return {
    labels,
    activeLabel,
    setActiveLabel,
    addLabel,
    deleteLabel,
    addLabels,
    updateLabel,
  };
};

type UseLabels<Tool> = ReturnType<typeof useLabels<Tool>>;

export type LabelsStore<Tool> = StoreState<UseLabels<Tool>> &
  StoreActions<UseLabels<Tool>>;
