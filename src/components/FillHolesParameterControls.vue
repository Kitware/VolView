<template>
  <div class="d-flex align-center">
    <mini-expansion-panel>
      <template #title
        >Fill enclosed holes in the segmentation on the axis of the selected
        view.</template
      >
      <ul>
        <li>Finds background regions fully enclosed by segments on a slice.</li>
        <li>
          Fills holes on the current slice by default, or every slice of the
          active view's axis.
        </li>
        <li>
          All-segments mode fills each hole with the surrounding segment's
          label; selected-segment mode fills only the active segment's holes.
        </li>
      </ul>
    </mini-expansion-panel>
  </div>

  <div
    v-for="scope in scopes"
    :key="scope.label"
    class="w-100 px-4 mb-4 d-flex flex-column align-center"
  >
    <div class="text-caption mb-1">{{ scope.label }}</div>
    <v-btn-toggle
      :model-value="scope.value"
      density="compact"
      variant="outlined"
      divided
      mandatory
      :disabled="isDisabled"
      @update:model-value="scope.onChange"
    >
      <v-btn
        v-for="option in scope.options"
        :key="option.value"
        :value="option.value"
        size="small"
      >
        {{ option.label }}
      </v-btn>
    </v-btn-toggle>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  useFillHolesStore,
  FillHolesSliceScope,
  FillHolesSegmentScope,
} from '@/src/store/tools/fillHoles';
import { usePaintProcessStore } from '@/src/store/tools/paintProcess';
import MiniExpansionPanel from './MiniExpansionPanel.vue';

const fillHolesStore = useFillHolesStore();
const processStore = usePaintProcessStore();

const isDisabled = computed(() => processStore.processStep !== 'start');

type ScopeControl = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
};

const scopes = computed<ScopeControl[]>(() => [
  {
    label: 'Slices',
    value: fillHolesStore.sliceScope,
    onChange: (value) =>
      fillHolesStore.setSliceScope(value as FillHolesSliceScope),
    options: [
      { value: FillHolesSliceScope.CurrentSlice, label: 'Current slice' },
      { value: FillHolesSliceScope.WholeVolume, label: 'All slices' },
    ],
  },
  {
    label: 'Segments',
    value: fillHolesStore.segmentScope,
    onChange: (value) =>
      fillHolesStore.setSegmentScope(value as FillHolesSegmentScope),
    options: [
      { value: FillHolesSegmentScope.AllSegments, label: 'All segments' },
      {
        value: FillHolesSegmentScope.SelectedSegment,
        label: 'Selected segment',
      },
    ],
  },
]);
</script>
