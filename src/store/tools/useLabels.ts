import { Maybe } from '@/src/types';
import { ref } from 'vue';
import { StoreActions, StoreState } from 'pinia';
import { getIDMaker } from '../ids';

export type LabelProps<Tool> = Partial<Tool & { labelName: string }>;
export type Labels<Tool> = Record<string, LabelProps<Tool>>;

type LabelID = string;

const labelDefault = { labelName: 'New Label' };

export const useLabels = <Tool>(newLabelDefault: LabelProps<Tool>) => {
  const labels = ref<Labels<Tool>>({});

  const activeLabel = ref<string | undefined>();
  const setActiveLabel = (id: string) => {
    activeLabel.value = id;
  };

  const idMaker = getIDMaker();
  const addLabel = (props: LabelProps<Tool> = {}) => {
    const id = idMaker.nextID();
    labels.value[id] = {
      ...labelDefault,
      ...newLabelDefault,
      ...props,
    };

    setActiveLabel(id);
    return id;
  };

  // param newLabels: each key is the label name
  const setLabels = (newLabels: Maybe<Labels<Tool>>) => {
    labels.value = {};

    Object.entries(newLabels ?? {}).forEach(([labelName, props]) => {
      addLabel({ ...props, labelName });
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
    setLabels,
    updateLabel,
  };
};

type UseLabels<Tool> = ReturnType<typeof useLabels<Tool>>;

export type LabelsStore<Tool> = StoreState<UseLabels<Tool>> &
  StoreActions<UseLabels<Tool>>;
