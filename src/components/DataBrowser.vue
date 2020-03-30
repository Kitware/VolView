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
import ItemGroup from '@/src/components/ItemGroup.vue';
import GroupableItem from '@/src/components/GroupableItem.vue';
import { mapActions, mapGetters, mapState } from 'vuex';

export default {
  name: 'DataBrowser',

  components: {
    ItemGroup,
    GroupableItem,
  },

  computed: {
    ...mapGetters('datasets', ['selectedDataProxyID']),
    ...mapState('datasets', {
      datasets: (state) => state.data.map((id) => state.dataIndex[id]),
    }),
    selection() {
      return this.selectedDataProxyID || null;
    },
  },

  methods: {
    setSelection(proxyID) {
      if (proxyID) {
        this.selectDataset(proxyID);
      }
    },

    ...mapActions('datasets', ['selectDataset']),
  },
};
</script>

<style>
</style>

<style scoped>
</style>
