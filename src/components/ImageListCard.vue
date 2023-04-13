<template>
  <v-hover v-slot="{ isHovering, props }">
    <v-card
      :disabled="disabled"
      variant="outlined"
      :ripple="!disabled"
      :class="{
        'image-list-card-hover': !disabled && isHovering,
        'image-list-card-active': !disabled && active,
      }"
      v-bind="disabled ? props : { ...props, ...$attrs }"
    >
      <v-container :title="htmlTitle">
        <v-row no-gutters class="flex-nowrap">
          <v-col v-if="selectable" cols="1" class="d-flex align-center">
            <v-checkbox
              @click.stop
              :key="id"
              density="compact"
              :disabled="disabled"
              :value="inputValue"
              :model-value="modelValue"
              @update:model-value="$emit('update:model-value', $event)"
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
            <v-overlay contained :model-value="!!$slots['image-overlay']">
              <slot name="image-overlay" />
            </v-overlay>
          </v-col>
          <v-col :cols="selectable ? 7 : 8">
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
.v-theme--light.image-list-card-hover {
  background-color: rgba(0, 0, 0, 0.1);
  border-color: rgba(0, 0, 0, 0.1);
  transition: all 0.25s;
}

.v-theme--dark.image-list-card-hover {
  background-color: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.1);
  transition: all 0.25s;
}

.v-theme--light.image-list-card-active {
  background-color: #b3e5fc;
  border-color: #b3e5fc;
}

.v-theme--dark.image-list-card-active {
  background-color: #01579b;
  border-color: #01579b;
}

.image-container {
  position: relative;
  margin-left: 8px;
  margin-right: 8px;
}
</style>

<script lang="ts">
import { defineComponent } from 'vue';

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
    modelValue: Array,
    inputValue: String,
    disabled: Boolean,
    htmlTitle: String,
  },
});
</script>
