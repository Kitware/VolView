<template>
  <div>
    <span>{{ message }}</span>
    &nbsp;
    <v-btn v-if="detailsButton" dark depressed size="small" color="#00000022">
      details
    </v-btn>
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
