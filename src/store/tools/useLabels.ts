import { Maybe } from '@/src/types';
import { ref } from 'vue';
import { StoreActions, StoreState } from 'pinia';
import { getIDMaker } from '../ids';

type LabelProps<Tool> = Partial<Tool & { labelName: string }>;
export type Labels<Tool> = Record<string, LabelProps<Tool>>;

export const useLabels = <Tool>(initialLabels: Maybe<Labels<Tool>>) => {
  const labels = ref<Labels<Tool>>({});

  const activeLabel = ref<string | undefined>();
  const setActiveLabel = (id: string) => {
    activeLabel.value = id;
  };

  const idMaker = getIDMaker();
  const addLabel = (props: LabelProps<Tool> = {}) => {
    const id = idMaker.nextID();
    labels.value[id] = {
      // ...defaultLabelProps,
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

  setLabels(initialLabels);

  const updateLabel = (name: string, props: LabelProps<Tool>) => {
    labels.value[name] = props;
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
