<script setup lang="ts">
import { computed, ref } from 'vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useServerStore, ConnectionState } from '@/src/store/server';

const serverStore = useServerStore();
const { client } = serverStore;
const ready = computed(
  () => serverStore.connState === ConnectionState.Connected
);

// --- adding --- //

const sum = ref(0);
const sumOp1 = ref(0);
const sumOp2 = ref(0);
const doSumLoading = ref(false);

const doSum = async () => {
  doSumLoading.value = true;
  try {
    sum.value = await client.call('add', [sumOp1.value, sumOp2.value]);
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
    trivia.value = (await client.call('number_trivia')) as string;
  } finally {
    triviaLoading.value = false;
  }
};

// --- stream test --- //

const streamProgress = ref(0);
const streamLoading = ref(false);

const streamProgressText = computed(() => {
  const p = streamProgress.value;
  return p < 100 ? p : 'Done!';
});

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
  await client.stream('progress', onStreamData);
};

// --- median filter --- //

const medianFilterLoading = ref(false);
const { currentImageID } = useCurrentImage();
const medianFilterRadius = ref(2);

const doMedianFilter = async () => {
  const id = currentImageID.value;
  if (!id) return;

  medianFilterLoading.value = true;
  try {
    await client.call('medianFilter', [id, medianFilterRadius.value]);
  } finally {
    medianFilterLoading.value = false;
  }
};

const hasCurrentImage = computed(() => !!currentImageID.value);
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
        <span class="ml-3"> Progress: {{ streamProgressText }} </span>
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
