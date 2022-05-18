<template>
  <v-card
    outlined
    ripple
    :color="active ? 'light-blue lighten-4' : ''"
    v-on="$listeners"
  >
    <v-container>
      <v-row no-gutters>
        <v-col cols="1" class="d-flex align-center">
          <v-checkbox id="test" @click.stop :key="id" :value="inputValue" :input-value="value" @change="onChange" />
        </v-col>
        <v-col
          cols="4"
          class="flex-grow-0"
          :style="{ width: `${imageSize}px` }"
        >
          <v-img
            contain
            :height="`${imageSize}px`"
            :width="`${imageSize}px`"
            :src="imageUrl"
          />
        </v-col>
        <v-col :cols="7" class="text-no-wrap">
          <div class="ml-2">
            <slot></slot>
          </div>
        </v-col>
      </v-row>
    </v-container>
  </v-card>
</template>

<script lang="ts">
import {
  defineComponent
} from '@vue/composition-api';

export default defineComponent({
  name: 'ImageListCard',
  props: {
    active: Boolean,
    imageSize: {
      type: Number,
      default: 80,
    },
    imageUrl: {
      type: String,
    },
    id: String,
    value: Array,
    inputValue: String
  },

  setup(props, context) {
    const onChange = (event: any) => {
        context.emit('input', event);
    }

    return {
      onChange,
    }
  }
});
</script>
