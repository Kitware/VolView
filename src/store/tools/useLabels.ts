import { ref } from 'vue';

type LabelProps<Tool> = Partial<Tool>;
export type Labels<Tool> = Record<string, LabelProps<Tool>>;

export const useLabels = <Tool>(initialLabels: Labels<Tool>) => {
  const labels = ref(initialLabels);

  const activeLabel = ref<string | undefined>();
  const setActiveLabel = (name: string) => {
    activeLabel.value = name;
  };

  const setLabels = (newLabels: Labels<Tool> | null | undefined) => {
    labels.value = newLabels ?? {};
    setActiveLabel(Object.keys(labels.value)[0]);
  };

  setLabels(initialLabels);

  return {
    labels,
    activeLabel,
    setActiveLabel,
    setLabels,
  };
};

export type SetActiveLabel = ReturnType<typeof useLabels>['setActiveLabel'];
