<script setup lang="ts">
import { computed } from 'vue';
import type { Maybe } from '@/src/types';
import { useWindowingStore } from '@/src/store/view-configs/windowing';
import {
  useEnFaceViewStore,
  type EnFaceViewConfig,
  type EnFaceViewControlState,
} from './store';
import EnFaceControls from './EnFaceControls.vue';

const props = defineProps<{
  viewId: string;
  dataId: Maybe<string>;
  embedded?: boolean;
}>();
const enFaceStore = useEnFaceViewStore();
const windowing = useWindowingStore();
const settings = computed(() =>
  enFaceStore.settingsFor(props.viewId, props.dataId)
);
const controlState = computed(() => {
  const state = props.dataId
    ? enFaceStore.controlStateFor(props.viewId, props.dataId)
    : null;
  if (state) return state;
  const reason = props.dataId
    ? 'En face rendering controls are being prepared.'
    : 'Load a volume in this En face view to adjust rendering.';
  return {
    axes: [],
    depthMaximum: 0,
    thresholdMaximum: 1,
    projectionReason: reason,
    segmentationReason: reason,
    highlightReason: reason,
    thicknessReason: reason,
    segments: [],
  } satisfies EnFaceViewControlState;
});
function resetContrast() {
  if (props.dataId && !controlState.value.projectionReason)
    windowing.resetContrast(props.viewId, props.dataId);
}
function patch(patchSettings: Partial<EnFaceViewConfig>) {
  const methodChanged =
    patchSettings.method !== undefined &&
    patchSettings.method !== settings.value.method;
  Object.assign(settings.value, patchSettings);
  if (
    methodChanged &&
    props.dataId &&
    !windowing.getConfig(props.viewId, props.dataId).useAuto
  )
    resetContrast();
}
</script>

<template>
  <div>
    <EnFaceControls
      v-bind="controlState"
      :settings="settings"
      :embedded="embedded"
      @patch="patch"
    />
  </div>
</template>
