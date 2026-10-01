<script setup lang="ts">
import { computed } from 'vue';
import ReasonedAction from '@/src/components/ReasonedAction.vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import {
  applyOCTLayout,
  getOCTLayoutReason,
  isOCTLayoutActive,
  OCT_LAYOUT_NAME,
} from './layout';

const active = computed(isOCTLayoutActive);
const { currentImageID } = useCurrentImage('global');
const reason = computed(() => getOCTLayoutReason(currentImageID.value));
function selectLayout() {
  const imageID = currentImageID.value;
  applyOCTLayout(imageID);
}
</script>

<template>
  <ReasonedAction :reason="reason ?? undefined" block>
    <v-list-item
      :active="active"
      :disabled="!!reason"
      @click="selectLayout"
      data-testid="oct-layout"
    >
      <v-list-item-title>{{ OCT_LAYOUT_NAME }}</v-list-item-title>
      <v-list-item-subtitle>B-scan + en face</v-list-item-subtitle>
    </v-list-item>
  </ReasonedAction>
</template>
