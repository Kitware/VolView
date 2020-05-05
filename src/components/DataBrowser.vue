<template>
  <div>
    <item-group :value="selection" @change="setSelection">
      <groupable-item
        v-for="item in datasets"
        :key="item.proxyID"
        v-slot="{ active, select }"
        :value="item.proxyID"
      >
        <v-btn
          :color="active ? 'primary' : ''"
          @click="select"
        >
          {{ item.name }}
        </v-btn>
      </groupable-item>
    </item-group>
  </div>
</template>

<script>
import { mapState } from 'vuex';

import ItemGroup from '@/src/components/ItemGroup.vue';
import GroupableItem from '@/src/components/GroupableItem.vue';
import { Data } from '@/src/types';

export default {
  name: 'DataBrowser',

  components: {
    ItemGroup,
    GroupableItem,
  },

  computed: {
    ...mapState('datasets', {
      datasets: (state) => Data.onlyVtkData(state.datasets),
    }),
  },
};
</script>

<style>
</style>

<style scoped>
</style>
