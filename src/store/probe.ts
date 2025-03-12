import { ref } from 'vue';
import { defineStore } from 'pinia';

export type ProbeSample = {
  id: string;
  name: string;
  displayValue: (string | number)[];
};

export type ProbeData =
  | {
      pos: number[];
      samples: ProbeSample[];
    }
  | undefined;

export const useProbeStore = defineStore('probe', () => {
  const probeData = ref<ProbeData>(undefined);

  const updateProbeData = (data: ProbeData) => {
    probeData.value = data;
  };

  const clearProbeData = () => {
    probeData.value = undefined;
  };

  return {
    probeData,
    updateProbeData,
    clearProbeData,
  };
});
