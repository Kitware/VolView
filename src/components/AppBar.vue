<script setup>
import { ref } from 'vue';
import { useDisplay } from 'vuetify';
import CloseableDialog from '@/src/components/CloseableDialog.vue';
import AboutBox from '@/src/components/AboutBox.vue';
import VolViewFullLogo from '@/src/components/icons/VolViewFullLogo.vue';
import VolViewLogo from '@/src/components/icons/VolViewLogo.vue';

const emit = defineEmits(['click:left-menu']);

const { mobile } = useDisplay();
const aboutBoxDialog = ref(false);
</script>

<template>
  <v-app-bar app clipped-left :height="48">
    <v-btn icon="mdi-menu" @click="emit('click:left-menu')" />
    <v-toolbar-title class="d-flex flex-row align-center mt-3">
      <vol-view-logo v-if="mobile" />
      <vol-view-full-logo v-else />
    </v-toolbar-title>
    <v-btn
      variant="text"
      icon
      :rounded="0"
      class="toolbar-button"
      href="https://volview.kitware.com/feedback/"
      target="_blank"
    >
      <v-icon icon="mdi-comment-question-outline"></v-icon>
      <v-tooltip activator="parent" location="bottom">
        Ask Question/Submit Feedback
      </v-tooltip>
    </v-btn>
    <v-btn
      variant="text"
      icon
      :rounded="0"
      class="toolbar-button"
      @click="aboutBoxDialog = !aboutBoxDialog"
    >
      <v-icon icon="mdi-information-outline"></v-icon>
      <v-tooltip activator="parent" location="bottom">About</v-tooltip>
    </v-btn>
  </v-app-bar>
  <closeable-dialog v-model="aboutBoxDialog">
    <about-box />
  </closeable-dialog>
</template>

<style src="@/src/components/styles/utils.css"></style>
<style scoped>
.toolbar-button {
  min-height: 100%; /* fill toolbar height */
}
</style>
