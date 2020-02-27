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
      {{ Tools[selectedTool] ? Tools[selectedTool].name : '' }}
    </resizable-nav-drawer>

    <v-content id="content-wrapper">
      <div class="d-flex flex-row flex-grow-1 grey darken-3">
        <div id="tools-strip" class="grey darken-4 d-flex flex-column align-center">
          <tool-button size="40" icon="mdi-folder-open" name="Open files" buttonClass="tool-btn" />
          <div class="mt-2 mb-1 tool-separator" />
          <v-item-group v-model="selectedTool">
            <template v-for="(tool,i) in Tools">
              <v-item
                :key="i"
                v-slot:default="{ active, toggle }"
              >
                <tool-button
                  size="40"
                  :icon="`mdi-${tool.icon}`"
                  :name="tool.name"
                  :buttonClass="[
                    'tool-btn',
                    active ? 'tool-btn-selected' : '',
                  ]"
                  @click="toggle"
                />
              </v-item>
            </template>
          </v-item-group>
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
import ToolButton from './components/ToolButton.vue';
import VtkView from './components/VtkView.vue';

import { readSingleFile } from './io';

export const NO_DS = -1;

export const Tools = [
  {
    name: 'Paint',
    icon: 'brush',
  },
  {
    name: 'Box',
    icon: 'selection',
  },
  {
    name: 'Ellipse',
    icon: 'selection-ellipse',
  },
  {
    name: 'Crop',
    icon: 'crop',
  },
];

export default {
  name: 'App',

  components: {
    ResizableNavDrawer,
    ToolButton,
    VtkView,
  },

  data: () => ({
    datasets: [],
    activeDatasetIndex: NO_DS,
    selectedTool: null,

    Tools,
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

    onFileSelect(evt) {
      const { files } = evt.target;
      this.loadingFiles = true;

      readSingleFile(files[0])
        .then((result) => console.log('good', result))
        .catch((err) => console.error('bad', err));
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
  border-top: 1px solid rgb(112, 112, 112);
}

.tool-btn {
  margin-top: 4px;
}

.tool-btn-selected {
  background-color: rgba(128, 128, 255, 0.7);
}
</style>
