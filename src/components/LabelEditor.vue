<script setup lang="ts">
// import { computed, ref } from 'vue';
// import { UpdateLabel } from '@/src/store/tools/useLabels';

// const props = defineProps<{
//   //   updateLabel: UpdateLabel;
//   //   label: LabelProps<AnnotationTool>;
// }>();
</script>

<template>
  <v-card>
    <v-card-title>Edit Label</v-card-title>

    <v-btn
      variant="text"
      density="compact"
      icon="mdi-close"
      @click="$emit('close')"
    />
  </v-card>
</template>

<style scoped></style>
