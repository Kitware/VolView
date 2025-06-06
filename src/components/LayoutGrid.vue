<template>
  <div
    class="layout-container flex-equal"
    :class="flexFlow"
    data-testid="layout-grid"
  >
    <div v-for="(item, i) in items" :key="i" class="d-flex flex-equal">
      <layout-grid v-if="item.type === 'layout'" :layout="(item as Layout)" />
      <div v-else class="layout-item" @dblclick="maximize(item.id!)">
        <component
          :is="item.component"
          :key="item.id"
          :id="item.id"
          :type="item.viewType"
          v-bind="item.props"
          @focus="onFocusView(item.id!, item.viewType!)"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, PropType, toRefs } from 'vue';
import { storeToRefs } from 'pinia';
import { ViewTypeToComponent } from '@/src/core/viewTypes';
import { Layout, LayoutDirection } from '../types/layout';
import { useViewStore } from '../store/views';
import { useToolStore } from '../store/tools';
import { ALLOW_MAXIMIZE_TOOLS } from '../config';

export default defineComponent({
  name: 'LayoutGrid',
  methods: {
    onFocusView(id: string, type: string) {
      if (type === '2D') {
        useViewStore().setActiveViewID(id);
      }
    },
    maximize(viewId: string) {
      const currentTool = useToolStore().currentTool;
      if (ALLOW_MAXIMIZE_TOOLS.includes(currentTool)) {
        useViewStore().toggleMaximizeView(viewId);
      }
    },
  },
  props: {
    layout: {
      type: Object as PropType<Layout>,
      required: true,
    },
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
            viewType: spec.viewType,
            component: ViewTypeToComponent[spec.viewType],
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
