<template>
  <v-expansion-panels accordion focusable id="data-browser">
    <v-expansion-panel>
      <v-expansion-panel-header color="#1976fa0a" class="no-select subtitle-1">
        Patients
      </v-expansion-panel-header>
      <v-expansion-panel-content class="content">
      </v-expansion-panel-content>
    </v-expansion-panel>
    <v-expansion-panel>
      <v-expansion-panel-header color="#1976fa0a" class="no-select subtitle-1">
        Annotations
      </v-expansion-panel-header>
      <v-expansion-panel-content class="content">
      </v-expansion-panel-content>
    </v-expansion-panel>
    <v-expansion-panel>
      <v-expansion-panel-header color="#1976fa0a" class="no-select subtitle-1">
        Images
      </v-expansion-panel-header>
      <v-expansion-panel-content class="content">
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
#data-browser .v-expansion-panel--active > .v-expansion-panel-header {
  min-height: unset;
}

#data-browser .v-expansion-panel-content__wrap {
  padding: 0 8px;
}

#data-browser .v-expansion-panel::before {
  box-shadow: none;
}
</style>

<style scoped>
#data-browser {
  border: 1px solid rgba(0, 0, 0, 0.12);
}
</style>
