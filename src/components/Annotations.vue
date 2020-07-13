<template>
  <v-container>
    <v-row no-gutters>
      <v-col :title="selectedLabelmap.name">
        <v-select
          label="Labelmap"
          placeholder="Select a labelmap..."
          no-data-text="No labelmaps"
          :items="labelmaps"
          item-text="name"
          item-value="id"
          :value="selectedLabelmap.id"
          @change="selectLabelmap"
        />
      </v-col>
    </v-row>
    <v-row no-gutters class="text-center">
      <v-col>
        <v-tooltip bottom>
          New labelmap
          <template v-slot:activator="{ on }">
            <v-btn
              :disabled="!hasSelectedBase"
              text
              v-on="on"
              @click="createLabelmapFromBase"
            >
              <v-icon>mdi-image-plus</v-icon>
            </v-btn>
          </template>
        </v-tooltip>
      </v-col>
      <!--
      <v-col>
        <v-tooltip bottom>
          Export labelmaps
          <template v-slot:activator="{ on }">
            <v-btn :disabled="!labelmaps.length" text v-on="on">
              <v-icon>mdi-content-save</v-icon>
            </v-btn>
          </template>
        </v-tooltip>
      </v-col>
      -->
      <v-col>
        <v-tooltip bottom>
          Delete labelmap
          <template v-slot:activator="{ on }">
            <v-btn
              :disabled="!hasSelectedLabelmap"
              text
              v-on="on"
              @click="removeSelectedLabelmap"
            >
              <v-icon>mdi-delete</v-icon>
            </v-btn>
          </template>
        </v-tooltip>
      </v-col>
    </v-row>
    <v-row no-gutters class="mt-2">
      <v-col>
        <v-slider
          v-model="radius"
          :min="radiusRange[0]"
          :max="radiusRange[1]"
          :step="1"
          label="Radius"
          class="align-center"
          hide-details
        >
          <template v-slot:append>
            <v-text-field
              v-model="radius"
              hide-details
              single-line
              type="number"
              class="mt-0 pt-0"
              style="width: 40px;"
            />
          </template>
        </v-slider>
      </v-col>
    </v-row>
  </v-container>
</template>

<script>
import { mapState, mapActions } from 'vuex';

import { NO_SELECTION } from '@/src/constants';

export default {
  name: 'Annotations',

  data() {
    return {};
  },

  computed: {
    ...mapState({
      selectedBaseImage: 'selectedBaseImage',
      selectedLabelmap: (state) => {
        const id = state.annotations.selectedLabelmap;
        return {
          id,
          name: id !== NO_SELECTION ? state.data.index[id].name : '',
        };
      },
      labelmaps: (state) =>
        state.data.labelmapIDs.map((id) => ({
          id,
          name: state.data.index[id].name,
        })),
    }),
    ...mapState('annotations', ['radiusRange']),
    hasSelectedBase() {
      return this.selectedBaseImage !== NO_SELECTION;
    },
    hasSelectedLabelmap() {
      return this.selectedLabelmap.id !== NO_SELECTION;
    },
    radius: {
      get() {
        return this.$store.state.annotations.radius;
      },
      set(v) {
        this.$store.dispatch('annotations/setRadius', Number(v));
      },
    },
  },

  methods: {
    createLabelmapFromBase() {
      this.createLabelmap(this.selectedBaseImage);
    },

    removeSelectedLabelmap() {
      if (this.selectedLabelmap !== NO_SELECTION) {
        const { id } = this.selectedLabelmap;
        // must happen before general removeData
        this.removeLabelmap(id);
        this.removeData(id);
      }
    },

    ...mapActions('annotations', {
      selectLabelmap: 'selectLabelmap',
      createLabelmap: 'createLabelmap',
      removeLabelmap: 'removeData',
    }),
    ...mapActions(['removeData']),
  },
};
</script>

<style></style>

<style scoped></style>
