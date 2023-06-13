import { Maybe } from '@/src/types';
import { ref } from 'vue';

type LabelProps<Tool> = Partial<Tool>;
export type Labels<Tool> = Record<string, LabelProps<Tool>>;

export const useLabels = <Tool>(initialLabels: Labels<Tool>) => {
  const labels = ref(initialLabels);

  const activeLabel = ref<string | undefined>();
  const setActiveLabel = (name: string) => {
    activeLabel.value = name;
  };

  const setLabels = (newLabels: Maybe<Labels<Tool>>) => {
    labels.value = newLabels ?? {};
    setActiveLabel(Object.keys(labels.value)[0]);
  };

  setLabels(initialLabels);

  const updateLabel = (name: string, props: LabelProps<Tool>) => {
    labels.value[name] = props;
  };

  return {
    labels,
    activeLabel,
    setActiveLabel,
    setLabels,
    updateLabel,
  };
};

export type SetActiveLabel = ReturnType<typeof useLabels>['setActiveLabel'];
export type UpdateLabel = ReturnType<typeof useLabels>['updateLabel'];
