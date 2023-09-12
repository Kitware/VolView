<template>
  <div
    class="layout-container flex-equal"
    :class="flexFlow"
    data-testid="layout-grid"
  >
    <div v-for="(item, i) in items" :key="i" class="d-flex flex-equal">
      <layout-grid v-if="item.type === 'layout'" :layout="item" />
      <div v-else class="layout-item">
        <component
          :is="item.component"
          :key="item.id"
          :id="item.id"
          v-bind="item.props"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { Component, computed, defineComponent, PropType, toRefs } from 'vue';
import { storeToRefs } from 'pinia';
import CurrentImageProvider from '@/src/components/CurrentImageProvider.vue';
import VtkTwoView from './VtkTwoView.vue';
import VtkThreeView from './VtkThreeView.vue';
import { Layout, LayoutDirection } from '../types/layout';
import { useViewStore } from '../store/views';
import { ViewType } from '../types/views';

const TYPE_TO_COMPONENT: Record<ViewType, Component> = {
  '2D': VtkTwoView,
  '3D': VtkThreeView,
};

export default defineComponent({
  name: 'LayoutGrid',
  props: {
    layout: {
      type: Object as PropType<Layout>,
      required: true,
    },
  },
  components: {
    CurrentImageProvider,
  },
  setup(props) {
    const { layout } = toRefs(props);
    const viewStore = useViewStore();
    const { viewSpecs } = storeToRefs(viewStore);

    const flexFlow = computed(() => {
      return layout.value.direction === LayoutDirection.H
        ? 'flex-column'
        : 'flex-row';
    });

    const items = computed(() => {
      const viewIDToSpecs = viewSpecs.value;
      return layout.value.items.map((item) => {
        if (typeof item === 'string') {
          const spec = viewIDToSpecs[item];
          return {
            type: 'view',
            id: item,
            component: TYPE_TO_COMPONENT[spec.viewType],
            props: spec.props,
          };
        }
        return {
          type: 'layout',
          ...item,
        };
      });
    });

    return {
      items,
      flexFlow,
    };
  },
});
</script>

<style scoped src="@/src/components/styles/utils.css"></style>

<style scoped>
.layout-container {
  display: flex;
  flex-direction: column;
}

.layout-item {
  display: flex;
  flex: 1;
  border: 1px solid #222;
}
</style>
