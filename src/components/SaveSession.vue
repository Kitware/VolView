<template>
  <v-card>
    <v-card-title class="d-flex flex-row align-center">
      Saving Session State
      <v-spacer />
      <v-btn variant="text" icon="mdi-close" @click="$emit('close')" />
    </v-card-title>
    <v-card-text>
      <v-form v-model="valid">
        <v-text-field
          v-on:keydown.enter="saveSession"
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
      <v-btn color="secondary" @click="saveSession" :disabled="!valid">
        <v-icon class="mr-2">mdi-content-save-all</v-icon>
        <span>Save</span>
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script lang="ts">
import { defineComponent, onMounted, ref } from 'vue';
import { save } from '../io/state-file';

const DEFAULT_FILENAME = 'session.volview.zip';

export default defineComponent({
  setup(_, { emit }) {
    const fileName = ref('');
    const valid = ref(true);

    async function saveSession() {
      if (fileName.value.trim().length >= 0) {
        await save(fileName.value);
        emit('close');
      }
    }

    onMounted(() => {
      fileName.value = DEFAULT_FILENAME;
    });

    function validFileName(name: string) {
      return name.trim().length > 0 || 'Required';
    }

    return {
      saveSession,
      fileName,
      validFileName,
      valid,
    };
  },
});
</script>
