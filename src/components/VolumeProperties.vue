<script lang="ts">
import { computed, defineComponent, ref } from 'vue';
import { useVolumeColoringInitializer } from '@/src/composables/useVolumeColoringInitializer';
import { useCurrentImage } from '../composables/useCurrentImage';
import { CVRConfig } from '../types/views';
import useVolumeColoringStore from '../store/view-configs/volume-coloring';
import { InitViewIDs } from '../config';

const TARGET_VIEW_ID = InitViewIDs.Three;

const LIGHTING_MODELS = {
  standard: 'Standard',
  hybrid: 'Hybrid',
};

export default defineComponent({
  name: 'VolumeRendering',
  setup() {
    const volumeColoringStore = useVolumeColoringStore();

    const { currentImageID } = useCurrentImage();

    useVolumeColoringInitializer(TARGET_VIEW_ID, currentImageID);

    const volumeColorConfig = computed(() =>
      volumeColoringStore.getConfig(TARGET_VIEW_ID, currentImageID.value)
    );

    // --- CVR --- //

    const cvrParams = computed(() => volumeColorConfig.value?.cvr);

    const setCVRParam = (key: keyof CVRConfig, value: any) => {
      if (!currentImageID.value) return;
      volumeColoringStore.updateCVRParameters(
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

    type LightingModel = keyof typeof LIGHTING_MODELS;
    const lightingModel = computed<LightingModel>(() =>
      cvrParams.value?.useVolumetricScatteringBlending ? 'hybrid' : 'standard'
    );
    const selectLightingMode = (model: LightingModel) => {
      setCVRParam('useVolumetricScatteringBlending', model === 'hybrid');
    };

    const volumeQualityLabels = {
      1: 'Good',
      2: 'Better',
      3: 'Ultra',
      4: 'Beta',
    };
    const showQualityWarning = ref(false);
    const disableQualityWarning = ref(false);

    return {
      LIGHTING_MODELS,
      cvrParams,
      disableQualityWarning,
      laoEnabled,
      lightingModel,
      selectLightingMode,
      setCVRParam,
      showQualityWarning,
      volumeQualityLabels,
      vsbEnabled,
    };
  },
});
</script>

<template>
  <div class="mx-2">
    <div v-if="!!cvrParams">
      <v-slider
        show-ticks="always"
        tick-size="4"
        :ticks="volumeQualityLabels"
        min="1"
        max="4"
        step="1"
        :model-value="cvrParams.volumeQuality"
        @update:model-value="
          {
            showQualityWarning = !disableQualityWarning && $event > 2;
            setCVRParam('volumeQuality', $event);
          }
        "
      />
      <v-alert
        v-model="showQualityWarning"
        border="top"
        variant="tonal"
        type="warning"
        color="grey"
        elevation="2"
        close-text="Close Warning"
        transition="slide-y-transition"
        density="compact"
        @click="showQualityWarning = false"
      >
        <div>
          <b>Ultra</b> and <b>Beta</b> modes are unstable on some systems.
        </div>
        <v-btn
          size="small"
          variant="tonal"
          block
          class="mt-2"
          @click="
            disableQualityWarning = true;
            showQualityWarning = false;
          "
        >
          Don't Show Again
        </v-btn>
      </v-alert>
      <v-divider class="my-8" />
      <v-slider
        label="Ambient"
        min="0"
        max="1"
        step="0.1"
        density="compact"
        hide-details
        thumb-label
        :model-value="cvrParams.ambient"
        @update:model-value="setCVRParam('ambient', $event)"
      />
      <v-slider
        label="Diffuse"
        min="0"
        max="1"
        step="0.1"
        density="compact"
        hide-details
        thumb-label
        :model-value="cvrParams.diffuse"
        @update:model-value="setCVRParam('diffuse', $event)"
      />
      <v-switch
        label="Light follows camera"
        density="compact"
        hide-details
        :model-value="cvrParams.lightFollowsCamera"
        @update:model-value="setCVRParam('lightFollowsCamera', !!$event)"
      />
      <v-divider class="my-8" />

      <v-switch
        label="Local Ambient Occlusion"
        density="compact"
        hide-details
        :model-value="cvrParams.useLocalAmbientOcclusion"
        @update:model-value="setCVRParam('useLocalAmbientOcclusion', !!$event)"
      />

      <v-row class="my-4">
        <v-btn-toggle
          :model-value="lightingModel"
          @update:model-value="selectLightingMode"
          mandatory
          divided
          variant="outlined"
          class="w-100"
        >
          <v-btn
            v-for="model in Object.keys(LIGHTING_MODELS)"
            :key="model"
            :value="model"
            class="w-50"
          >
            {{ model }}
          </v-btn>
        </v-btn-toggle>
      </v-row>

      <v-spacer class="my-2" />

      <v-slider
        label="Scatter Blending"
        min="0"
        max="1"
        step="0.05"
        density="compact"
        hide-details
        thumb-label
        v-if="vsbEnabled"
        :model-value="cvrParams.volumetricScatteringBlending"
        @update:model-value="
          setCVRParam('volumetricScatteringBlending', $event)
        "
      />
    </div>
  </div>
</template>
