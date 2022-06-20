<template>
  <div class="layout-container" :class="flexFlow">
    <div v-for="(item, i) in items" :key="i" class="d-flex flex-grow-1">
      <layout-grid v-if="Array.isArray(item)" :layout="item" />
      <div v-else-if="item" class="layout-item">
        <component :is="item.comp" v-bind="item.props" />
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'LayoutGrid',
  props: {
    layout: Array, // [split:String, ...items:[]Component|[]Array]
  },
  computed: {
    flexFlow() {
      const split = this.layout[0];
      return split === 'H' ? 'flex-column' : 'flex-row';
    },
    items() {
      return this.layout.slice(1);
    },
  },
};
</script>

<style scoped>
.layout-container {
  display: flex;
  flex-direction: column;
  flex-grow: 1;
}

.layout-item {
  display: flex;
  flex: 1 1;
  border: 1px solid #222;
}
</style>
