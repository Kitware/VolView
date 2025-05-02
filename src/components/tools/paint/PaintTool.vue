<template>
  <div class="overlay-no-events">
    <PaintWidget2D
      v-if="active"
      :view-id="viewId"
      :image-id="imageId"
      :view-direction="viewDirection"
    />
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, PropType } from 'vue';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { PaintMode } from '@/src/core/tools/paint';
import { LPSAxisDir } from '@/src/types/lps';
import { Maybe } from '@/src/types';
import PaintWidget2D from './PaintWidget2D.vue';

export default defineComponent({
  name: 'PaintTool',
  props: {
    viewId: {
      type: String,
      required: true,
    },
    viewDirection: {
      type: String as PropType<LPSAxisDir>,
      required: true,
    },
    imageId: String as PropType<Maybe<string>>,
  },
  components: {
    PaintWidget2D,
  },
  setup() {
    const paintStore = usePaintToolStore();
    const active = computed(
      () =>
        paintStore.isActive && paintStore.activeMode !== PaintMode.FillBetween
    );

    return {
      active,
    };
  },
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
