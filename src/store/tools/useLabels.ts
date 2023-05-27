import { ref } from 'vue';

type LabelProps<Tool> = Partial<Tool>;
export type Labels<Tool> = Record<string, LabelProps<Tool>>;

export const useLabels = <Tool>(initialLabels: Labels<Tool>) => {
  const labels = ref(initialLabels);

  const initialLabel = Object.keys(labels.value)[0];
  const activeLabel = ref<typeof initialLabel | undefined>(initialLabel);
  const setActiveLabel = (name: string) => {
    activeLabel.value = name;
  };

  return {
    labels,
    activeLabel,
    setActiveLabel,
  };
};

export type SetActiveLabel = ReturnType<typeof useLabels>['setActiveLabel'];
