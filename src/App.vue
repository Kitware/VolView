<template>
  <v-app>
    <resizable-nav-drawer
      app
      permanent
      color="#e0e0e0"
      :min-width="200"
      :max-width="400"
      :width="300"
    >
    </resizable-nav-drawer>

    <v-content id="content-wrapper">
      <div class="d-flex flex-row flex-grow-1 grey darken-3">
        <div id="tools-strip" class="d-flex flex-column blue lighten-2 align-center">
          <template v-for="(tool,i) in tools">
            <template v-if="tool === 'SEPARATOR'">
              <div :key="i" class="mt-2 mb-1 tool-separator" />
            </template>
            <template v-else>
              <v-tooltip
                :key="i"
                right
                transition="slide-x-transition"
              >
                <template v-slot:activator="{ on }">
                  <v-btn
                    class="white--text mt-1"
                    text
                    tile
                    dark
                    :disabled="!activeDataset"
                    height="40"
                    width="40"
                    min-width="40"
                    max-width="40"
                    v-on="on"
                  >
                    <v-icon>mdi-{{ tool }}</v-icon>
                  </v-btn>
                </template>
                <span>{{ tool }}</span>
              </v-tooltip>
            </template>
          </template>
        </div>
        <v-container class="d-flex flex-column flex-grow-1 pa-0">
          <template v-if="!datasets.length">
            <v-row
              no-gutters
              align="center"
              class="clickable"
              @click="userPromptFiles"
            >
              <v-col>
                <v-row justify="center">
                  <v-card flat dark color="transparent" class="text-center headline">
                    <div>
                      <v-icon size="64">mdi-folder-open</v-icon>
                    </div>
                    <div>
                      Click anywhere here to open files
                    </div>
                    <div class="mt-8">
                      <v-icon size="64">mdi-arrow-down-bold</v-icon>
                    </div>
                    <div>
                      Drop your files anywhere here to open
                    </div>
                  </v-card>
                </v-row>
              </v-col>
            </v-row>
          </template>
          <template v-else>
            <v-row no-gutters>
              <v-col class="pa-0" cols="6"><vtk-view /></v-col>
              <v-col class="pa-0" cols="6"><vtk-view /></v-col>
            </v-row>
            <v-row no-gutters>
              <v-col class="pa-0" cols="6"><vtk-view /></v-col>
              <v-col class="pa-0" cols="6"><vtk-view /></v-col>
            </v-row>
          </template>
        </v-container>
      </div>
    </v-content>
  </v-app>
</template>

<script>
import ResizableNavDrawer from './components/ResizableNavDrawer.vue';
import VtkView from './components/VtkView.vue';

const NO_DS = -1;

export default {
  name: 'App',

  components: {
    ResizableNavDrawer,
    VtkView,
  },

  data: () => ({
    datasets: [],
    activeDatasetIndex: NO_DS,
    tools: [
      'angle-acute',
      'ruler',
      'pencil',
      'SEPARATOR',
      'crop',
      'death-star-variant',
      'eyedropper',
      'fire',
      'flask-empty-plus',
      'gesture',
      'layers',
      'magnet-on',
      'SEPARATOR',
      'pipe-wrench',
      'run',
      'seat-flat-angled',
      'SEPARATOR',
      'white-balance-incandescent',
    ],
  }),

  computed: {
    activeDataset() {
      return this.activeDatasetIndex === NO_DS ? null : this.datasets[this.activeDatasetIndex];
    },
  },

  mounted() {
    const fileEl = document.createElement('input');
    fileEl.setAttribute('type', 'file');
    fileEl.setAttribute('multiple', 'multiple');
    fileEl.setAttribute('accept', '*');
    fileEl.addEventListener('change', this.onFileSelect);
    this.fileEl = fileEl;
  },

  methods: {
    userPromptFiles() {
      this.fileEl.value = null;
      this.fileEl.click();
    },

    onFileSelect(/* evt */) {
      // const { files } = evt.target;
      this.loadingFiles = true;
    },
  },
};
</script>

<style>
#content-wrapper {
  /* disable v-content transition when we resize our app drawer */
  transition: initial;
}

#content-wrapper > .v-content__wrap {
  display: flex;
}

#tools-strip {
  flex: 0 0 40px;
}

.view-box {
  box-sizing: border-box;
}

.clickable {
  cursor: pointer;
}

.tool-separator {
  width: 75%;
  height: 1px;
  border: none;
  border-top: 1px solid rgb(212, 212, 212);
}
</style>
