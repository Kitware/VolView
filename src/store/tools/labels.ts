import { computed, ref } from '@vue/composition-api';
import { defineStore } from 'pinia';
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

export const useLabelStore = defineStore('labels', () => {
  const initialLabels = parseLabelUrlParam();
  const labels = ref(initialLabels);

  const initialName = Object.keys(labels.value)[0] ?? undefined;
  const selectedName = ref(initialName);
  const setSelected = (name: string) => {
    selectedName.value = name;
  };

  const selectedColor = computed(() => labels.value[selectedName.value]);

  return {
    labels,
    selectedName,
    setSelected,
    selectedColor,
  };
});
