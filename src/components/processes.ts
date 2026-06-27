import type { Component } from 'vue';
import {
  ProcessType,
  type ProcessAlgorithm,
} from '@/src/store/tools/paintProcess';
import {
  useFillHolesStore,
  FillHolesSegmentScope,
} from '@/src/store/tools/fillHoles';
import { useFillBetweenStore } from '@/src/store/tools/fillBetween';
import { useGaussianSmoothStore } from '@/src/store/tools/gaussianSmooth';
import FillHolesParameterControls from './FillHolesParameterControls.vue';
import FillBetweenParameterControls from './FillBetweenParameterControls.vue';
import GaussianSmoothParameterControls from './GaussianSmoothParameterControls.vue';

export type ProcessDefinition = {
  type: ProcessType;
  label: string;
  icon: string;
  controls: Component;
  // Resolved lazily so each call reads the live store (Pinia singletons).
  getAlgorithm: () => ProcessAlgorithm;
  // Whether the process needs the active segment. Defaults to true; processes
  // that act on every segment opt out. Resolved lazily for reactivity.
  requiresActiveSegment?: () => boolean;
};

// Single source of truth for the paint processes. Adding a process is one
// entry here instead of synchronized edits across the selector, the controls,
// and the type enum.
export const PROCESS_DEFINITIONS: ProcessDefinition[] = [
  {
    type: ProcessType.FillHoles,
    label: 'Fill Holes',
    icon: 'mdi-format-color-fill',
    controls: FillHolesParameterControls,
    getAlgorithm: () => useFillHolesStore().computeAlgorithm,
    requiresActiveSegment: () =>
      useFillHolesStore().segmentScope ===
      FillHolesSegmentScope.SelectedSegment,
  },
  {
    type: ProcessType.FillBetween,
    label: 'Fill Between',
    icon: 'mdi-layers-triple',
    controls: FillBetweenParameterControls,
    getAlgorithm: () => useFillBetweenStore().computeAlgorithm,
  },
  {
    type: ProcessType.GaussianSmooth,
    label: 'Smooth',
    icon: 'mdi-blur',
    controls: GaussianSmoothParameterControls,
    getAlgorithm: () => useGaussianSmoothStore().computeAlgorithm,
  },
];
