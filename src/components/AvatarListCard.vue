<template>
  <v-card
    outlined
    ripple
    :color="active ? 'light-blue lighten-4' : ''"
    v-on="$listeners"
  >
    <v-container>
      <v-row no-gutters>
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
        <v-col :cols="showMenu ? 7 : 8" class="text-no-wrap">
          <div class="ml-2">
            <slot></slot>
          </div>
        </v-col>
        <v-col v-if="$slots.menu" cols="1">
          <v-menu>
            <template v-slot:activator="{ on, attrs }">
              <v-btn
                small
                icon
                class="mt-n1"
                v-bind="attrs"
                v-on="on"
                @mousedown.stop
                @click.stop
              >
                <v-icon>mdi-dots-vertical</v-icon>
              </v-btn>
            </template>
            <slot name="menu" />
          </v-menu>
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

  computed: {
    showMenu() {
      return !!this.$slots.menu;
    },
  },
};
</script>
