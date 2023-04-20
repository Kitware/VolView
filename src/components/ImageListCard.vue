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
      v-bind="{ ...props, ...$attrs }"
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
            <persistent-overlay :disabled="!$slots['image-overlay']">
              <slot name="image-overlay" />
            </persistent-overlay>
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
.image-list-card-active {
  background-color: rgb(var(--v-theme-selection-bg-color));
  border-color: rgb(var(--v-theme-selection-border-color));
}

.image-container {
  position: relative;
  margin-left: 8px;
  margin-right: 8px;
}
</style>

<script lang="ts">
import { defineComponent } from 'vue';
import PersistentOverlay from './PersistentOverlay.vue';

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
  components: { PersistentOverlay },
});
</script>
