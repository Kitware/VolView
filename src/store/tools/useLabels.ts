import { computed, ref } from 'vue';
import vtkURLExtract from '@kitware/vtk.js/Common/Core/URLExtract';
import { UrlParams } from '@vueuse/core';
import { chunk } from '@/src/utils';

type LabelColor = string;
type Labels = Record<string, LabelColor>;

const ensureHash = (color: string | number) => {
  const colorStr = color.toString();
  if (colorStr.startsWith('#')) return colorStr;
  return `#${color}`;
};

const parseLabelUrlParam = () => {
  const urlParams = vtkURLExtract.extractURLParameters() as UrlParams;
  const rawLabels = urlParams.labels;
  if (!rawLabels || !Array.isArray(rawLabels)) return {};

  const labelMap = chunk(rawLabels, 2)
    .map(([name, color]) => ({
      name,
      color: ensureHash(color),
    }))
    .reduce(
      (labels, { name, color }) => ({
        ...labels,
        [name]: color,
      }),
      {} as Labels
    );

  return labelMap;
};

export const useLabels = () => {
  const initialLabels = parseLabelUrlParam();
  const labels = ref(initialLabels);

  const initialLabel = Object.keys(labels.value)[0] ?? '';
  const activeLabel = ref(initialLabel);
  const setActiveLabel = (name: string) => {
    activeLabel.value = name;
  };

  const activeColor = computed(() => labels.value[activeLabel.value]);

  return {
    labels,
    activeLabel,
    setActiveLabel,
    activeColor,
  };
};
