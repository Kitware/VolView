<template>
  <v-card>
    <v-card-title class="d-flex flex-row align-center">
      Saving Session State
      <v-spacer />
      <v-btn variant="text" icon="mdi-close" @click="$emit('close')" />
    </v-card-title>
    <v-card-text>
      <v-form v-model="valid" @submit.prevent="saveSession">
        <v-text-field
          v-model="fileName"
          hint="The filename to use for the session state file."
          label="Session State Filename"
          :rules="[validFileName]"
          required
        />
      </v-form>
    </v-card-text>
    <v-card-actions>
      <v-spacer />
      <v-btn
        :loading="saving"
        color="secondary"
        @click="saveSession"
        :disabled="!valid"
      >
        <v-icon class="mr-2">mdi-content-save-all</v-icon>
        <span>Save</span>
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script lang="ts">
import { defineComponent, onMounted, ref } from 'vue';
import { saveAs } from 'file-saver';

import { serialize } from '../io/state-file';

const DEFAULT_FILENAME = 'session.volview.zip';

export default defineComponent({
  setup(_, { emit }) {
    const fileName = ref('');
    const valid = ref(true);
    const saving = ref(false);

    async function saveSession() {
      if (fileName.value.trim().length >= 0) {
        saving.value = true;
        try {
          const blob = await serialize();
          saveAs(blob, fileName.value);
          emit('close');
        } finally {
          saving.value = false;
        }
      }
    }

    onMounted(() => {
      fileName.value = DEFAULT_FILENAME;
    });

    function validFileName(name: string) {
      return name.trim().length > 0 || 'Required';
    }

    return {
      saving,
      saveSession,
      fileName,
      validFileName,
      valid,
    };
  },
});
</script>
