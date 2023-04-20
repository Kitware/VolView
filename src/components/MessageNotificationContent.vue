<template>
  <div>
    <span>{{ message }}</span>
    &nbsp;
    <button v-if="detailsButton" class="button">details</button>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  props: {
    message: String,
    detailsButton: Boolean,
  },
});
</script>

<style scoped>
.button {
  background: rgba(0, 0, 0, 0.2);
  padding: 4px 8px;
  border-radius: 3px;
  text-transform: capitalize;
}
</style>
