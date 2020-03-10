<template>
  <v-expansion-panels accordion focusable id="data-browser">
    <v-expansion-panel>
      <v-expansion-panel-header color="#1976fa0a" class="no-select subtitle-1">
        Patients
      </v-expansion-panel-header>
      <v-expansion-panel-content class="mt-3 content">
      </v-expansion-panel-content>
    </v-expansion-panel>
    <v-expansion-panel>
      <v-expansion-panel-header color="#1976fa0a" class="no-select subtitle-1">
        Annotations
      </v-expansion-panel-header>
      <v-expansion-panel-content class="mt-3 content">
      </v-expansion-panel-content>
    </v-expansion-panel>
    <v-expansion-panel>
      <v-expansion-panel-header color="#1976fa0a" class="no-select subtitle-1">
        Images
      </v-expansion-panel-header>
      <v-expansion-panel-content class="mt-3 content">
      </v-expansion-panel-content>
    </v-expansion-panel>
  </v-expansion-panels>
</template>

<script>
export default {
  name: 'DataBrowser',
};
</script>

<style>
/* override vuetify */
#data-browser .v-expansion-panel--active > .v-expansion-panel-header {
  min-height: unset;
}
</style>

<style scoped>
</style>
