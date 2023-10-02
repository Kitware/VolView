<script lang="ts">
import { computed, defineComponent } from 'vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import useWindowingStore from '@/src/store/view-configs/windowing';
import { useViewStore } from '@/src/store/views';
import { WLAutoRanges } from '@/src/constants';

export default defineComponent({
  setup() {
    const { currentImageID } = useCurrentImage();
    const windowingStore = useWindowingStore();
    const viewStore = useViewStore();

    // Get the relevant view ids
    const viewIDs = computed(() =>
      viewStore.viewIDs.filter(
        (viewID) => !!windowingStore.getConfig(viewID, currentImageID.value)
      )
    );

    function parseLabel(text: string) {
      return text.replace(/([A-Z])/g, ' $1').trim();
    }

    // --- Reset --- //

    const resetWindowLevel = () => {
      const imageID = currentImageID.value;
      if (!imageID) return;
      // Reset the window/level for all views
      viewIDs.value.forEach((viewID) =>
        windowingStore.resetWindowLevel(viewID, imageID)
      );
    };

    // --- Automatic Range Options --- //

    const wlAutoSettings = computed({
      get() {
        // All views will have the same setting, just grab the first
        const viewID = viewIDs.value[0];
        const config = windowingStore.getConfig(viewID, currentImageID.value);
        return config?.auto || 'Default';
      },
      set(selection: string) {
        const imageID = currentImageID.value;
        if (imageID) {
          viewIDs.value.map((viewID) =>
            windowingStore.updateConfig(viewID, imageID, {
              auto: selection,
            })
          );
        }
      },
    });

    return {
      resetWindowLevel,
      WLAutoRanges,
      wlAutoSettings,
      parseLabel,
    };
  },
});
</script>

<template>
  <v-card dark>
    <v-card-text>
      <v-radio-group v-model="wlAutoSettings" hide-details>
        <p>Auto</p>
        <hr />
        <v-radio
          v-for="(value, key) in WLAutoRanges"
          :key="key"
          :label="`${parseLabel(key)} (${0 + value}, ${100 - value})`"
          :value="key"
          density="compact"
        />
      </v-radio-group>
      <v-btn
        prepend-icon="mdi-restore"
        variant="text"
        block
        @click="resetWindowLevel"
      >
        Reset
      </v-btn>
    </v-card-text>
  </v-card>
</template>
