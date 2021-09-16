<template>
  <div class="d-flex flex-column mx-2 height-100">
    <div id="submodule-select">
      <v-select
        v-model="currentSubModule"
        :items="subModules"
        item-text="name"
        return-object
        dense
        filled
        single-line
        hide-details
        placeholder="Select a module"
        class="no-select"
      />
    </div>
    <div id="component">
      <template v-if="currentSubModule">
        <component :is="currentSubModule.component" />
      </template>
      <div v-else>No submodule selected</div>
    </div>
  </div>
</template>

<script>
import { defineComponent, ref } from '@vue/composition-api';

import SpleenModule from './SpleenModule.vue';

export default defineComponent({
  name: 'AiModule',
  setup() {
    const currentSubModule = ref(null);

    return {
      currentSubModule,
      subModules: [{ name: 'Spleen Segmentation', component: SpleenModule }],
    };
  },
});
</script>

<style scoped>
#submodule-select {
  border-bottom: 1px solid rgba(0, 0, 0, 0.12);
  padding-bottom: 12px;
}

#component {
  flex: 2;
  margin-top: 12px;
  overflow-y: auto;
}
</style>
