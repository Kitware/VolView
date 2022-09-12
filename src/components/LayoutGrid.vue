<template>
  <div class="layout-container flex-equal" :class="flexFlow">
    <div v-for="(item, i) in items" :key="i" class="d-flex flex-equal">
      <layout-grid v-if="item.objType === 'Layout'" :layout="item" />
      <div v-else-if="item.objType === 'View'" class="layout-item">
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
import {
  computed,
  defineComponent,
  toRefs,
  PropType,
} from '@vue/composition-api';
import VtkTwoView from './VtkTwoView.vue';
import VtkThreeView from './VtkThreeView.vue';
import { Layout, LayoutDirection } from '../types/layout';

const TYPE_TO_COMPONENT = {
  View2D: VtkTwoView,
  View3D: VtkThreeView,
};

export default defineComponent({
  name: 'LayoutGrid',
  props: {
    layout: {
      required: true,
      type: Object as PropType<Layout>,
    },
  },
  setup(props) {
    const { layout } = toRefs(props);
    const flexFlow = computed(() => {
      return layout.value.direction === LayoutDirection.H
        ? 'flex-column'
        : 'flex-row';
    });

    const items = computed(() => {
      return layout.value.items.map((item) => {
        if (item.objType === 'View') {
          return {
            objType: 'View',
            id: item.id,
            component: TYPE_TO_COMPONENT[item.viewType],
            props: item.props,
          };
        }
        return item;
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
