<template>
  <v-card>
    <v-card-title>
      Saving Session State
      <v-spacer />
      <v-btn icon @click="$emit('close')"><v-icon>mdi-close</v-icon></v-btn>
    </v-card-title>
    <v-card-text>
      <v-form v-model="valid">
        <v-text-field
          v-on:keyup.enter="saveSession"
          v-model="fileName"
          hint="The filename to use for the session state file."
          label="Session State Filename"
          :rules="[validFileName]"
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
import { defineComponent, ref } from '@vue/composition-api';
import { save } from '../io/state-file';

const DEFAULT_FILENAME = 'session.volview.zip';

export default defineComponent({
  setup(props, { emit }) {
    const fileName = ref(DEFAULT_FILENAME);
    const valid = ref(true);

    async function saveSession() {
      await save(fileName.value);
      emit('close');
    }

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
