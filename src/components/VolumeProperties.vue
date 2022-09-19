<script lang="ts">
import { computed, defineComponent, watch } from '@vue/composition-api';
import { useCurrentImage } from '../composables/useCurrentImage';
import { useViewConfigStore } from '../store/view-configs';
import { CVRConfig } from '../store/view-configs/volume-coloring';

const TARGET_VIEW_ID = '3D';

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

    const setCVREnabled = (enabled: boolean) => {
      if (!currentImageID.value) return;
      viewConfigStore.updateVolumeCVRParameters(
        TARGET_VIEW_ID,
        currentImageID.value,
        {
          enabled,
        }
      );
    };

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

    const enabled = computed(() => !!cvrParams.value?.enabled);
    const laoEnabled = computed(
      () => !!cvrParams.value?.useLocalAmbientOcclusion
    );
    const vsbEnabled = computed(
      () => !!cvrParams.value?.useVolumetricScatteringBlending
    );

    return {
      cvrParams,
      enabled,
      laoEnabled,
      vsbEnabled,
      setCVREnabled,
      setCVRParam,
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
      <v-switch
        label="Enable Cinematic Volume Rendering"
        dense
        hide-details
        :value="enabled"
        @change="setCVREnabled"
      />
      <v-divider class="my-4" />
      <v-switch
        label="Flip Light Position"
        dense
        hide-details
        :disabled="!enabled"
        :value="cvrParams.flipLightPosition"
        @change="setCVRParam('flipLightPosition', $event)"
      />
      <v-switch
        label="Enable Volumetric Scattering"
        dense
        :disabled="!enabled || laoEnabled"
        :value="vsbEnabled"
        @change="setCVRParam('useVolumetricScatteringBlending', $event)"
      />
      <v-slider
        label="Blending"
        min="0"
        max="1"
        step="0.05"
        dense
        hide-details
        thumb-label
        :disabled="!enabled || !vsbEnabled"
        :value="cvrParams.volumetricScatteringBlending"
        @input="setCVRParam('volumetricScatteringBlending', $event)"
      />
      <v-switch
        label="Enable Local Ambient Occlusion"
        dense
        :disabled="!enabled || vsbEnabled"
        :value="laoEnabled"
        @change="setCVRParam('useLocalAmbientOcclusion', $event)"
      />
      <v-slider
        label="LAO Kernel Size"
        min="5"
        max="32"
        step="1"
        dense
        hide-details
        thumb-label
        :disabled="!enabled || !laoEnabled"
        :value="cvrParams.laoKernelSize"
        @input="setCVRParam('laoKernelSize', $event)"
      />
      <v-slider
        label="LAO Kernel Radius"
        min="1"
        max="15"
        step="1"
        dense
        hide-details
        thumb-label
        :disabled="!enabled || !laoEnabled"
        :value="cvrParams.laoKernelRadius"
        @input="setCVRParam('laoKernelRadius', $event)"
      />
      <v-slider
        label="Ambient"
        min="0"
        max="1"
        step="0.1"
        dense
        hide-details
        thumb-label
        :disabled="!enabled"
        :value="cvrParams.ambient"
        @input="setCVRParam('ambient', $event)"
      />
      <v-slider
        label="Diffuse"
        min="0"
        max="2"
        step="0.1"
        dense
        hide-details
        thumb-label
        :disabled="!enabled"
        :value="cvrParams.diffuse"
        @input="setCVRParam('diffuse', $event)"
      />
    </div>
  </div>
</template>
