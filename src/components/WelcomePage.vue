<script setup lang="ts">
import { ref, computed } from 'vue';
import CloseableDialog from '@/src/components/CloseableDialog.vue';
import DataSecurityBox from '@/src/components/DataSecurityBox.vue';
import useRemoteSaveStateStore from '@/src/store/remote-save-state';

withDefaults(
  defineProps<{
    loading?: boolean;
  }>(),
  {
    loading: false,
  }
);

const isRemoteSaveDisabled = computed(
  () => useRemoteSaveStateStore().saveUrl === ''
);
const dataSecurityDialog = ref(false);
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
              <div v-if="isRemoteSaveDisabled" class="vertical-offset-margin">
                <v-icon size="64">mdi-cloud-off-outline</v-icon>
              </div>
              <div v-if="isRemoteSaveDisabled">
                Secure: Image data never leaves your machine.
              </div>
              <v-btn
                class="mt-2"
                variant="tonal"
                color="secondary"
                @click.stop="dataSecurityDialog = true"
              >
                Learn More
              </v-btn>
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
  <closeable-dialog v-model="dataSecurityDialog">
    <data-security-box />
  </closeable-dialog>
</template>

<style scoped>
.page-container {
  flex: 1 1 auto;
  display: flex;
  flex-flow: row;
  align-items: center;
  max-width: 100%;
}

.vertical-offset-margin {
  margin-top: 128px;
}
</style>
