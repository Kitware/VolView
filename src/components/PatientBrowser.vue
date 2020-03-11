<template>
  <div id="patient-module" class="mx-2 height-100">
    <div id="patient-filter-controls">
      <v-select
        dense
        filled
        single-line
        hide-details
        label="Patient"
        prepend-icon="mdi-account"
        class="no-select"
      />
      <v-select
        dense
        filled
        single-line
        hide-details
        label="Study"
        prepend-icon="mdi-folder-table"
        class="no-select mt-2"
      />
    </div>
    <div id="patient-data-list">
      <v-expansion-panels accordion multiple id="patient-data-list-panels">
        <template v-for="i in 5">
          <v-expansion-panel :key="i" :value="true">
            <v-expansion-panel-header color="#1976fa0a" class="no-select subtitle-2">
              Series 1 MR (44 images)
            </v-expansion-panel-header>
            <v-expansion-panel-content>
              <div class="d-flex flex-row flex-wrap ma-2">
                <template v-for="i in 20">
                  <div :key="i" class="meow" />
                </template>
              </div>
            </v-expansion-panel-content>
          </v-expansion-panel>
        </template>
      </v-expansion-panels>
    </div>
  </div>
</template>

<script>
export default {
  name: 'DataBrowser',

  data() {
    return {
      hierarchyModel: {},
      // TODO test: whatever constructs dataHierarchy must have a patient/study/series hierarchy
      dataHierarchy: [
        {
          id: 1, // String: concatenate patient UID with opened timestamp
          type: 'patient',
          name: 'Anonymized',
          children: [
            {
              id: 2,
              type: 'study',
              studyID: 'some study id',
              studyDate: 'date',
              studyTime: 'time',
            },
          ],
        },
      ],
    };
  },
};
</script>

<style>
#patient-data-list-panels .v-expansion-panel--active > .v-expansion-panel-header {
  /* don't grow expansion panel when opened */
  min-height: unset;
}

#patient-data-list-panels .v-expansion-panel--active > .v-expansion-panel-header {
  /* don't grow expansion panel when opened */
  min-height: unset;
}

#patient-data-list-panels .v-expansion-panel-content__wrap {
  /* reduce content padding */
  padding: 0 8px;
}

#patient-data-list-panels .v-expansion-panel::before {
  /* no drop-shadow */
  box-shadow: none;
}
</style>

<style scoped>
#patient-module {
  display: flex;
  flex-flow: column;
}

#patient-filter-controls {
  border-bottom: 1px solid rgba(0, 0, 0, 0.12);
  padding-bottom: 12px;
}

#patient-data-list {
  flex: 2;
  margin-top: 12px;
  overflow-y: scroll;
}

#patient-data-list-panels {
  width: calc(100% - 0px);
  border: 1px solid rgba(0, 0, 0, 0.12);
}

.meow {
  width: 50px;
  height: 50px;
  background: grey;
  margin: 4px;
}
</style>
