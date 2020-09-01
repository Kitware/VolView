<template>
  <div
    v-on:dragover.prevent="onDragOver"
    v-on:dragleave="onDragLeave"
    v-on:drop.prevent="onDrop"
  >
    <slot :dragHover="dragHover" />
  </div>
</template>

<script>
export default {
  name: 'DragAndDrop',
  props: {
    enabled: Boolean,
  },
  data() {
    return {
      dragHover: false,
    };
  },
  methods: {
    onDragOver(ev) {
      if (this.enabled) {
        const { types } = ev.dataTransfer;
        if (
          types && types instanceof Array
            ? types.indexOf('Files') !== -1
            : 'Files' in types
        ) {
          this.dragHover = true;
          if (this.dragTimeout !== null) {
            window.clearTimeout(this.dragTimeout);
            this.dragTimeout = null;
          }
        }
      }
    },
    onDragLeave() {
      if (this.enabled) {
        this.dragTimeout = window.setTimeout(() => {
          this.dragHover = false;
          this.dragTimeout = null;
        }, 50);
      }
    },
    onDrop(ev) {
      if (this.enabled) {
        this.$emit('drop', Array.from(ev.dataTransfer.files));
        this.dragHover = false;
      }
    },
  },
  created() {
    // used to debounce dragover
    this.dragTimeout = null;
  },
};
</script>
