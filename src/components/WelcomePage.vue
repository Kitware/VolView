<script setup lang="ts">
withDefaults(
  defineProps<{
    loading?: boolean;
  }>(),
  {
    loading: false,
  }
);
</script>

<template>
  <v-container class="page-container bg-grey-darken-3" v-bind="$attrs">
    <v-col>
      <v-row justify="center">
        <v-card
          flat
          dark
          rounded="0"
          color="transparent"
          class="text-center headline"
        >
          <template v-if="!loading">
            <div>
              <v-icon size="64">mdi-folder-open</v-icon>
            </div>
            <div>Click to open local files.</div>
            <div class="mt-8">
              <v-icon size="64">mdi-arrow-down-bold</v-icon>
            </div>
            <div>Drag &amp; drop your DICOM files.</div>

            <div class="vertical-offset-margin">
              <slot></slot>
            </div>
          </template>
          <template v-else>
            <div class="text-h6 my-4">Loading data...</div>
            <v-progress-linear indeterminate />
          </template>
        </v-card>
      </v-row>
    </v-col>
  </v-container>
</template>

<style scoped>
.page-container {
  flex: 1 1 auto;
  display: flex;
  flex-flow: row;
  align-items: center;
  max-width: 100%;
}
</style>
