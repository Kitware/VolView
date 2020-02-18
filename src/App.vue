<template>
  <v-app>
    <resizable-nav-drawer
      app
      permanent
      :min-width="200"
      :max-width="400"
      :width="300"
    >
      <v-tabs>
        <v-tab>Data</v-tab>
        <v-tab>Annotations</v-tab>
      </v-tabs>
    </resizable-nav-drawer>

    <v-content id="content-wrapper">
      <div class="d-flex flex-row flex-grow-1">
        <div id="tools-strip" class="d-flex flex-column blue lighten-2">
          <v-tooltip
            v-for="tool in tools"
            :key="tool"
            right
            transition="slide-x-transition"
          >
            <template v-slot:activator="{ on }">
              <v-btn
                class="white--text mt-1"
                depressed
                tile
                color="blue lighten-2"
                height="40"
                width="40"
                min-width="40"
                max-width="40"
                :ripple="false"
                v-on="on"
              >
                <v-icon>mdi-{{ tool }}</v-icon>
              </v-btn>
            </template>
            <span>{{ tool }}</span>
          </v-tooltip>
        </div>
        <v-container class="d-flex flex-column flex-grow-1 pa-0">
          <v-row no-gutters>
            <v-col class="pa-0 view-box" cols="6">Sag</v-col>
            <v-col class="pa-0 view-box" cols="6">3D</v-col>
          </v-row>
          <v-row no-gutters>
            <v-col class="pa-0 view-box" cols="6">Cor</v-col>
            <v-col class="pa-0 view-box" cols="6">Axi</v-col>
          </v-row>
        </v-container>
      </div>
    </v-content>
  </v-app>
</template>

<script>
import ResizableNavDrawer from './components/ResizableNavDrawer.vue';

export default {
  name: 'App',

  components: {
    ResizableNavDrawer,
  },

  data: () => ({
    tools: [
      'angle-acute',
      'ruler',
      'pencil',
      'crop',
      'death-star-variant',
      'eyedropper',
      'fire',
      'flask-empty-plus',
      'gesture',
      'layers',
      'magnet-on',
      'pipe-wrench',
      'run',
      'seat-flat-angled',
      'white-balance-incandescent',
    ],
  }),
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
</style>
