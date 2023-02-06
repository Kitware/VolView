<script lang="ts">
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtk from '@kitware/vtk.js/vtk';
import { computed, defineComponent, onMounted, ref } from 'vue';
import { Maybe } from '@/src/types';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import RemoteConnection from '@/src/core/remote/remote-connection';
import { useImageStore } from '@/src/store/datasets-images';
import { useDatasetStore } from '@/src/store/datasets';

export default defineComponent({
  setup() {
    const url = process.env.VUE_APP_REMOTE_SERVER_URL || '';

    const ready = ref(false);
    const rconn = new RemoteConnection(url);

    onMounted(async () => {
      await rconn.connect();
      ready.value = true;
    });

    // --- adding --- //

    const sum = ref(0);
    const sumOp1 = ref(0);
    const sumOp2 = ref(0);
    const doSumLoading = ref(false);

    const doSum = async () => {
      doSumLoading.value = true;
      try {
        sum.value = await rconn.call('add', [sumOp1.value, sumOp2.value]);
      } finally {
        doSumLoading.value = false;
      }
    };

    // --- number trivia --- //

    const trivia = ref('');
    const triviaLoading = ref(false);

    const getTrivia = async () => {
      triviaLoading.value = true;
      try {
        trivia.value = (await rconn.call('number_trivia')) as string;
      } finally {
        triviaLoading.value = false;
      }
    };

    // --- stream test --- //

    const streamProgress = ref(0);
    const streamLoading = ref(false);

    type StreamData = { progress: number };

    const onStreamData = (data: StreamData) => {
      const { progress } = data;
      streamProgress.value = progress;
      if (progress === 100) {
        streamLoading.value = false;
      }
    };

    const startStream = async () => {
      streamLoading.value = true;
      await rconn.stream('number_stream', onStreamData);
    };

    // --- median filter --- //

    const medianFilterLoading = ref(false);
    const medianFilterImageID = ref<Maybe<string>>(null);
    const { currentImageData } = useCurrentImage();
    const medianFilterRadius = ref(2);

    const viewBlurredImage = () => {
      if (medianFilterImageID.value) {
        const dataStore = useDatasetStore();
        dataStore.setPrimarySelection({
          type: 'image',
          dataID: medianFilterImageID.value,
        });
      }
    };

    const doMedianFilter = async () => {
      const image = currentImageData.value;
      if (!image) return;

      medianFilterLoading.value = true;
      try {
        const blurredImageJSON = await rconn.call('median_filter', [
          image.toJSON(),
          medianFilterRadius.value,
        ]);
        const blurredImage = vtk(blurredImageJSON) as vtkImageData;

        const imageStore = useImageStore();
        if (medianFilterImageID.value) {
          imageStore.updateData(medianFilterImageID.value, blurredImage);
        } else {
          medianFilterImageID.value = imageStore.addVTKImageData(
            'Blurred image',
            blurredImage
          );
        }
        viewBlurredImage();
      } finally {
        medianFilterLoading.value = false;
      }
    };

    const hasCurrentImage = computed(() => !!currentImageData.value);

    return {
      ready,

      doSum,
      doSumLoading,
      sum,
      sumOp1,
      sumOp2,

      getTrivia,
      trivia,
      triviaLoading,

      startStream,
      streamLoading,
      streamProgress: computed(() => {
        const p = streamProgress.value;
        return p < 100 ? p : 'Done!';
      }),

      doMedianFilter,
      medianFilterLoading,
      hasCurrentImage,
      medianFilterRadius,
    };
  },
});
</script>

<template>
  <div class="overflow-y-auto overflow-x-hidden ma-2 fill-height">
    <v-alert v-if="!ready" color="info">Not connected to the server.</v-alert>
    <v-divider />
    <v-list-subheader>Add numbers</v-list-subheader>
    <v-row class="pb-3">
      <v-col cols="3">
        <v-text-field
          :model-value="sumOp1"
          @update:model-value="sumOp1 = Number($event || 0)"
          type="number"
          variant="outlined"
          density="compact"
          hide-details
          placeholder="0"
        />
      </v-col>
      <v-col cols="1" class="d-flex flex-row align-center">+</v-col>
      <v-col cols="3">
        <v-text-field
          :model-value="sumOp2"
          @update:model-value="sumOp2 = Number($event || 0)"
          type="number"
          variant="outlined"
          density="compact"
          hide-details
          placeholder="0"
        />
      </v-col>
      <v-col cols="1" class="d-flex flex-row align-center">
        <v-btn @click="doSum" :loading="doSumLoading" :disabled="!ready">
          =>
        </v-btn>
        <span class="ml-3">{{ sum }}</span>
      </v-col>
    </v-row>
    <v-divider />
    <v-list-subheader>Trivia</v-list-subheader>
    <v-row>
      <v-btn @click="getTrivia" :loading="triviaLoading" :disabled="!ready">
        Random number trivia
      </v-btn>
    </v-row>
    <v-row>
      <v-col>
        <label for="remote-trivia-text">
          <textarea
            id="remote-trivia-text"
            readonly
            class="text-white"
            style="width: 100%"
            :value="trivia"
          />
        </label>
      </v-col>
    </v-row>
    <v-divider />
    <v-list-subheader>Progress</v-list-subheader>
    <v-row class="mb-4">
      <v-col>
        <v-btn @click="startStream" :loading="streamLoading" :disabled="!ready">
          Start progress
        </v-btn>
        <span class="ml-3"> Progress: {{ streamProgress }} </span>
      </v-col>
    </v-row>
    <v-divider />
    <v-list-subheader>Median Filter</v-list-subheader>
    <div>
      <v-row>
        <v-col cols="3">
          <v-text-field
            :model-value="medianFilterRadius"
            @update:model-value="medianFilterRadius = Number($event || 0)"
            type="number"
            variant="outlined"
            density="compact"
            hide-details
            placeholder="1"
          />
        </v-col>
        <v-col>
          <v-btn
            @click="doMedianFilter"
            :loading="medianFilterLoading"
            :disabled="!ready || !hasCurrentImage"
          >
            Run Median Filter
          </v-btn>
          <span v-if="!hasCurrentImage" class="ml-4 body-2">
            No image loaded
          </span>
        </v-col>
      </v-row>
    </div>
  </div>
</template>
