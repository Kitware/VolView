<script lang="ts">
import { computed, defineComponent, watch } from '@vue/composition-api';
import { useCurrentImage } from '../composables/useCurrentImage';
import { useViewConfigStore } from '../store/view-configs';
import { CVRConfig } from '../types/views';

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
      <v-divider class="my-4" />
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
        max="2"
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
      <v-switch
        label="Enable Volumetric Scattering"
        dense
        :disabled="laoEnabled"
        :input-value="vsbEnabled"
        @change="setCVRParam('useVolumetricScatteringBlending', !!$event)"
      />
      <v-slider
        label="Blending"
        min="0"
        max="1"
        step="0.05"
        dense
        hide-details
        thumb-label
        :disabled="!vsbEnabled"
        :value="cvrParams.volumetricScatteringBlending"
        @change="setCVRParam('volumetricScatteringBlending', $event)"
      />
      <v-switch
        label="Enable Local Ambient Occlusion"
        dense
        :disabled="vsbEnabled"
        :input-value="laoEnabled"
        @change="setCVRParam('useLocalAmbientOcclusion', !!$event)"
      />
      <v-slider
        label="LAO Kernel Size"
        min="3"
        max="10"
        step="1"
        dense
        hide-details
        thumb-label
        :disabled="!laoEnabled"
        :value="cvrParams.laoKernelSize"
        @change="setCVRParam('laoKernelSize', $event)"
      />
      <v-slider
        label="LAO Kernel Radius"
        :min="cvrParams.laoKernelSize * 2"
        :max="cvrParams.laoKernelSize * 2 + 10"
        step="1"
        dense
        hide-details
        thumb-label
        :disabled="!laoEnabled"
        :value="cvrParams.laoKernelRadius"
        @change="setCVRParam('laoKernelRadius', $event)"
      />
    </div>
  </div>
</template>
