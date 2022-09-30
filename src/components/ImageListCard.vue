<template>
  <v-hover v-slot="{ hover }">
    <v-card
      :disabled="disabled"
      outlined
      ripple
      :class="{
        'image-list-card-hover': hover,
        'image-list-card-active': active,
      }"
      v-on="$listeners"
    >
      <v-container>
        <v-row no-gutters class="flex-nowrap">
          <v-col v-if="selectable" cols="1" class="d-flex align-center">
            <v-checkbox
              @click.stop
              :key="id"
              :value="inputValue"
              :input-value="value"
              @change="onChange"
            />
          </v-col>
          <v-col
            cols="4"
            class="image-container flex-grow-0"
            :style="{ maxWidth: `${imageSize}px` }"
          >
            <v-img
              contain
              :height="`${imageSize}px`"
              :width="`${imageSize}px`"
              :src="imageUrl"
            />
            <v-overlay absolute :value="$slots['image-overlay']">
              <slot name="image-overlay" />
            </v-overlay>
          </v-col>
          <v-col :cols="7">
            <div class="ml-2">
              <slot></slot>
            </div>
          </v-col>
        </v-row>
      </v-container>
    </v-card>
  </v-hover>
</template>

<style scoped>
.theme--light.image-list-card-hover {
  background-color: rgba(0, 0, 0, 0.1);
  border-color: rgba(0, 0, 0, 0.1);
  transition: all 0.25s;
}

.theme--dark.image-list-card-hover {
  background-color: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.1);
  transition: all 0.25s;
}

.theme--light.image-list-card-active {
  background-color: #b3e5fc;
  border-color: #b3e5fc;
}

.theme--dark.image-list-card-active {
  background-color: #01579b;
  border-color: #01579b;
}

.image-container {
  position: relative;
  margin-right: 20px;
}
</style>

<script lang="ts">
import { defineComponent } from '@vue/composition-api';

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
    selectable: {
      type: Boolean,
      default: false,
    },
    id: String,
    value: Array,
    inputValue: String,
    disabled: Boolean,
  },

  setup(props, { emit }) {
    const onChange = (event: any) => {
      emit('input', event);
    };

    return {
      onChange,
    };
  },
});
</script>
