import { ref } from 'vue';
import vtkURLExtract from '@kitware/vtk.js/Common/Core/URLExtract';
import { UrlParams } from '@vueuse/core';
import { chunk } from '@/src/utils';

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

// object property parser type
type ObjectParser<T> = Partial<
  Record<keyof T, (val: string | number) => T[keyof T]>
>;

export const parseLabelUrlParam = <Tool>(
  paramKey: string,
  // object with keys of Tool and function that returns value of that key
  labelPropParsers: ObjectParser<Tool>
) => {
  const urlParams = vtkURLExtract.extractURLParameters() as UrlParams;
  const rawLabels = urlParams[paramKey];
  if (!rawLabels || !Array.isArray(rawLabels)) return undefined;
  // if URL param is empty array, disable labels
  if (rawLabels.length === 1 && rawLabels[0] === '') return {};

  const keys = Object.keys(labelPropParsers);
  const parsers = Object.values(labelPropParsers) as Array<
    (val: string) => any
  >;

  // take chunked array with first value as label name and rest as props
  return chunk(rawLabels, keys.length + 1).reduce(
    (labels, [name, ...props]) => {
      const labelProps = Object.fromEntries(
        props.map((prop, i) => [keys[i], parsers[i](prop)])
      );
      return {
        ...labels,
        [name]: labelProps,
      };
    },
    {}
  );
};

export const ensureHash = (color: string | number) => {
  const colorStr = color.toString();
  if (colorStr.startsWith('#')) return colorStr;
  return `#${color}`;
};
