<template>
  <div id="model-module" class="mx-2 height-100">
    <template v-if="hasModels">
      <v-expansion-panels>
        <v-expansion-panel v-for="model in models" :key="model.id">
          <v-expansion-panel-header>
            {{ model.name }}
          </v-expansion-panel-header>
          <v-expansion-panel-content>
            <v-select
              label="Color By"
              :items="model.pointArrays"
              item-text="name"
              item-value="value"
              :value="model.colorBy"
              @change="setColorBy(model.id, $event)"
            />
          </v-expansion-panel-content>
        </v-expansion-panel>
      </v-expansion-panels>
    </template>
    <template v-else>
      <div>No models loaded</div>
    </template>
  </div>
</template>

<script>
import { mapState, mapActions } from 'vuex';

const SOLID_COLOR = Symbol('SOLID_COLOR');

export default {
  name: 'ModelBrowser',

  computed: {
    ...mapState({
      vtkCache: (state) => state.data.vtkCache,
      dataIndex: (state) => state.data.index,
      modelIDs: (state) => state.data.modelIDs,
    }),
    ...mapState('visualization', ['colorBy']),

    models() {
      return this.modelIDs.map((id) => ({
        ...this.dataIndex[id],
        id,
        colorBy: this.colorBy[id]?.array || SOLID_COLOR,
        pointArrays: [{ name: 'Solid Color', value: SOLID_COLOR }].concat(
          this.vtkCache[id]
            .getPointData()
            .getArrays()
            .map((arr) => ({ name: arr.getName(), value: arr.getName() }))
        ),
      }));
    },

    hasModels() {
      return !!this.models.length;
    },
  },

  methods: {
    setColorBy(id, arrayName) {
      let array;
      let location;
      if (arrayName === SOLID_COLOR) {
        array = '';
        location = '';
      } else {
        array = arrayName;
        location = 'pointData';
      }

      this.setModelColorBy({
        id,
        colorBy: { array, location },
      });
    },
    ...mapActions('visualization', ['setModelColorBy']),
  },
};
</script>
