<template>
  <div>
    <item-group
      :value="selectedBaseImage"
      @change="setSelection"
    >
      <groupable-item
        v-for="imgID in imageList"
        :key="imgID"
        v-slot="{ active, select }"
        :value="imgID"
      >
        <v-card
          outlined
          ripple
          :color="active ? 'light-blue lighten-4' : ''"
          :title="dataIndex[imgID].name"
          @click="select"
        >
          <v-container>
            <v-row no-gutters>
              <v-col cols="4">
                <v-img
                  contain
                  height="100px"
                  width="100px"
                  :src="getThumbnail(imgID)"
                />
              </v-col>
              <v-col cols="8" class="text-no-wrap">
                <div class="body-2 text-truncate">
                  {{ dataIndex[imgID].name }}
                </div>
                <div class="caption">Dims: ({{ dataIndex[imgID].dims.join(', ') }})</div>
                <div class="caption">
                  Spacing: ({{ dataIndex[imgID].spacing.map((s) => s.toFixed(2)).join(', ') }})
                </div>
              </v-col>
            </v-row>
          </v-container>
        </v-card>
      </groupable-item>
    </item-group>
  </div>
</template>

<script>
import { mapState, mapActions } from 'vuex';

import ItemGroup from '@/src/components/ItemGroup.vue';
import GroupableItem from '@/src/components/GroupableItem.vue';

import { renderAllViews } from '@/src/vtk/proxyUtils';

const canvas = document.createElement('canvas');

// Assume itkImage type is Uint8Array
function scalarImageToURI(values, width, height, scaleMin, scaleMax) {
  const im = new ImageData(width, height);
  const arr32 = new Uint32Array(im.data.buffer);
  // scale to 1 unsigned byte
  const factor = 255 / (scaleMax - scaleMin);
  for (let i = 0; i < values.length; i += 1) {
    const byte = Math.floor((values[i] - scaleMin) * factor);
    // ABGR order
    // eslint-disable-next-line no-bitwise
    arr32[i] = (255 << 24) | (byte << 16) | (byte << 8) | byte;
  }

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(im, 0, 0);
  return canvas.toDataURL('image/png');
}

export default {
  name: 'DataBrowser',

  components: {
    ItemGroup,
    GroupableItem,
  },

  data() {
    return {
      thumbnails: {}, // id -> thumbnail uri
    };
  },

  computed: {
    ...mapState(['selectedBaseImage']),
    ...mapState({
      imageList: (state) => state.data.imageIDs,
      dataIndex: (state) => state.data.index,
      vtkCache: (state) => state.data.vtkCache,
    }),
  },

  watch: {
  },

  methods: {
    async setSelection(sel) {
      this.selectBaseImage(sel);

      await this.updateSceneLayers();
      await this.resetViews();
      renderAllViews(this.$proxyManager);
    },

    getThumbnail(id) {
      if (id in this.thumbnails) {
        return this.thumbnails[id];
      }
      if (id in this.vtkCache) {
        const imageData = this.vtkCache[id];
        const scalars = imageData.getPointData().getScalars();
        const dims = imageData.getDimensions();
        const length = dims[0] * dims[1];
        const sliceOffset = Math.floor(dims[2] / 2) * length;
        const slice = scalars.getData().subarray(sliceOffset, sliceOffset + length);
        const dataRange = scalars.getRange();

        const img = scalarImageToURI(slice, dims[0], dims[1], dataRange[0], dataRange[1]);
        this.$set(this.thumbnails, id, img);
        return img;
      }
      return '';
    },

    ...mapActions(['selectBaseImage', 'updateSceneLayers', 'resetViews']),
  },
};
</script>

<style>
</style>

<style scoped>
</style>
