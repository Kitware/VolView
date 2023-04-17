<script lang="ts">
import { computed, defineComponent, ref, watch } from '@vue/composition-api';
import { useCurrentImage } from '../composables/useCurrentImage';
import { useViewConfigStore } from '../store/view-configs';
import { CVRConfig } from '../types/views';

const TARGET_VIEW_ID = '3D';

const LIGHTING_MODELS = {
  standard: 'Standard',
  hybrid: 'Hybrid',
};

export default defineComponent({
  name: 'VolumeRendering',
  setup() {
    const viewConfigStore = useViewConfigStore();

    const { currentImageID } = useCurrentImage();

    const volumeColorConfig = viewConfigStore.getComputedVolumeColorConfig(
      TARGET_VIEW_ID,
      currentImageID
    );

    watch(volumeColorConfig, () => {
      const imageID = currentImageID.value;
      if (imageID && !volumeColorConfig.value) {
        // creates a default color config
        viewConfigStore.updateVolumeColorConfig(TARGET_VIEW_ID, imageID, {});
      }
    });

    // --- CVR --- //

    const cvrParams = computed(() => volumeColorConfig.value?.cvr);

    const setCVRParam = (key: keyof CVRConfig, value: any) => {
      if (!currentImageID.value) return;
      viewConfigStore.updateVolumeCVRParameters(
        TARGET_VIEW_ID,
        currentImageID.value,
        {
          [key]: value,
        }
      );
    };

    const laoEnabled = computed(
      () => !!cvrParams.value?.useLocalAmbientOcclusion
    );
    const vsbEnabled = computed(
      () => !!cvrParams.value?.useVolumetricScatteringBlending
    );

    const lightingModel = ref(0);
    const selectLightingMode = (buttonIdx: number) => {
      setCVRParam('useVolumetricScatteringBlending', buttonIdx !== 0);
    };

    const volumeQualityLabels = ['Sturdy', 'Robust', 'Extreme', 'Ludicrous'];
    const showQualityWarning = false;
    const disableQualityWarning = false;

    return {
      LIGHTING_MODELS,
      cvrParams,
      laoEnabled,
      lightingModel,
      selectLightingMode,
      setCVRParam,
      showQualityWarning,
      volumeQualityLabels,
      vsbEnabled,
      disableQualityWarning,
    };
  },
});
</script>

<template>
  <div class="mx-2">
    <div class="mt-4" ref="editorContainerRef">
      <div ref="pwfEditorRef" />
    </div>
    <div v-if="!!cvrParams">
      <v-tooltip
        v-model="showQualityWarning"
        class="align-center justify-center"
        scroll-strategy="none"
        contained
        bottom
        :disabled="true"
      >
        <template v-slot:activator="{ props }">
          <v-slider
            ticks="always"
            tick-size="4"
            :tick-labels="volumeQualityLabels"
            min="1"
            max="4"
            step="1"
            :value="cvrParams.volumeQuality"
            v-bind="props"
            @change="
              {
                showQualityWarning = !disableQualityWarning && $event > 2;
                setCVRParam('volumeQuality', $event);
              }
            "
          />
          <v-expand-transition>
            <v-card v-if="showQualityWarning">
              <v-card-title>Warning</v-card-title>
              <v-card-subtitle
                >Higher values are unstable on some systems</v-card-subtitle
              >
              <v-card-actions>
                <v-tooltip
                  scroll-strategy="none"
                  contained
                  bottom
                  class="align-center justify-center"
                >
                  <template v-slot:activator="{ on, props }">
                    <v-btn
                      small
                      icon
                      @click="showQualityWarning = false"
                      v-bind="props"
                      v-on="on"
                    >
                      <v-icon>mdi-close</v-icon>
                    </v-btn>
                  </template>
                  <span>Close this warning</span>
                </v-tooltip>
                <v-tooltip
                  scroll-strategy="none"
                  contained
                  bottom
                  class="align-center justify-center"
                >
                  <template v-slot:activator="{ on, props }">
                    <v-btn
                      small
                      icon
                      @click="
                        {
                          disableQualityWarning = true;
                          showQualityWarning = false;
                        }
                      "
                      v-bind="props"
                      v-on="on"
                    >
                      <v-icon>mdi-minus-circle</v-icon>
                    </v-btn>
                  </template>
                  <span>Disable this warning</span>
                </v-tooltip>
              </v-card-actions>
            </v-card>
          </v-expand-transition>
        </template>
      </v-tooltip>
      <v-divider class="my-8" />
      <v-slider
        label="Ambient"
        min="0"
        max="1"
        step="0.1"
        dense
        hide-details
        thumb-label
        :value="cvrParams.ambient"
        @change="setCVRParam('ambient', $event)"
      />
      <v-slider
        label="Diffuse"
        min="0"
        max="1"
        step="0.1"
        dense
        hide-details
        thumb-label
        :value="cvrParams.diffuse"
        @change="setCVRParam('diffuse', $event)"
      />
      <v-switch
        label="Light follows camera"
        dense
        hide-details
        :input-value="cvrParams.lightFollowsCamera"
        @change="setCVRParam('lightFollowsCamera', !!$event)"
      />
      <v-divider class="my-8" />

      <v-row class="my-4">
        <v-btn-toggle
          v-model="lightingModel"
          @change="selectLightingMode"
          mandatory
        >
          <v-btn
            v-for="model in Object.values(LIGHTING_MODELS)"
            :key="model"
            block
          >
            {{ model }}
          </v-btn>
        </v-btn-toggle>
      </v-row>

      <v-switch
        label="Local Ambient Occlusion"
        dense
        hide-details
        :input-value="cvrParams.useLocalAmbientOcclusion"
        @change="setCVRParam('useLocalAmbientOcclusion', !!$event)"
      />

      <v-spacer class="my-2" />

      <v-slider
        label="Scatter Blending"
        min="0"
        max="1"
        step="0.05"
        dense
        hide-details
        thumb-label
        v-if="vsbEnabled"
        :value="cvrParams.volumetricScatteringBlending"
        @change="setCVRParam('volumetricScatteringBlending', $event)"
      />
    </div>
  </div>
</template>
