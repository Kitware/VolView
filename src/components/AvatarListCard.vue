<template>
  <v-card
    outlined
    ripple
    :color="active ? 'light-blue lighten-4' : ''"
    v-on="$listeners"
  >
    <v-container>
      <v-row no-gutters>
        <v-col cols="4">
          <v-img
            contain
            :height="`${imageSize}px`"
            :width="`${imageSize}px`"
            :src="imageUrl"
          />
        </v-col>
        <v-col cols="8" class="text-no-wrap">
          <div class="ml-2">
            <slot></slot>
          </div>
        </v-col>
      </v-row>
    </v-container>
  </v-card>
</template>

<script>
export default {
  name: 'AvatarListCard',

  props: {
    active: Boolean,
    imageSize: {
      type: Number,
      default: 80,
    },
    imageUrl: {
      type: String,
    },
  },
};
</script>
