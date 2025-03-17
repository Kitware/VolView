import { ref } from 'vue';
import { defineStore } from 'pinia';
import { vec3 } from 'gl-matrix';

export type ProbeSample = {
  id: string;
  name: string;
  displayValues: (string | number)[];
};

export type ProbeData =
  | {
      pos: vec3;
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
