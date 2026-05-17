<script setup lang="ts">
import { computed, ref, toRefs, watch } from 'vue';
import { useIntervalFn } from '@vueuse/core';
import { Maybe } from '@/src/types';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import { getCineImage } from '@/src/core/cine/isCineImage';
import {
  clampCineFps,
  MAX_CINE_FPS,
  MIN_CINE_FPS,
  useCinePlaybackStore,
} from '@/src/store/view-configs/cine-playback';

type Props = {
  viewId: string;
  imageId: Maybe<string>;
};

const props = defineProps<Props>();
const { imageId, viewId } = toRefs(props);

const cine = computed(() => getCineImage(imageId.value));
const { slice, range } = useSliceConfig(viewId, imageId);
const playbackStore = useCinePlaybackStore();

const fpsInput = ref('');

const playbackConfig = computed(() =>
  playbackStore.getConfig(
    viewId.value,
    imageId.value,
    cine.value?.header.frameTimeMs
  )
);

function updatePlayback(
  patch: Parameters<typeof playbackStore.updateConfig>[2]
) {
  if (!viewId.value || !imageId.value) return;
  playbackStore.updateConfig(
    viewId.value,
    imageId.value,
    patch,
    cine.value?.header.frameTimeMs
  );
}

const playing = computed({
  get: () => playbackConfig.value.playing,
  set: (value: boolean) => {
    updatePlayback({ playing: value });
  },
});

const fps = computed({
  get: () => playbackConfig.value.fps,
  set: (value: number) => {
    updatePlayback({ fps: value });
  },
});

watch(
  fps,
  (value) => {
    fpsInput.value = String(value);
  },
  { immediate: true }
);

const period = computed(() =>
  fps.value > 0 ? Math.max(1, Math.round(1000 / fps.value)) : 1000
);

const { pause, resume } = useIntervalFn(
  () => {
    const [min, max] = range.value;
    if (max <= min) return;
    const next = (slice.value ?? min) + 1;
    slice.value = next > max ? min : next;
  },
  period,
  { immediate: false, immediateCallback: false }
);

watch(
  playing,
  (isPlaying) => {
    if (isPlaying) resume();
    else pause();
  },
  { immediate: true }
);

// Pause when the cine clip changes (or is removed).
watch(imageId, (nextImageId, previousImageId) => {
  if (previousImageId && previousImageId !== nextImageId && viewId.value) {
    playbackStore.updateConfig(
      viewId.value,
      previousImageId,
      {
        playing: false,
      },
      getCineImage(previousImageId)?.header.frameTimeMs
    );
  }

  if (nextImageId && previousImageId !== nextImageId && viewId.value) {
    updatePlayback({ playing: false });
  }
});

function togglePlay() {
  playing.value = !playing.value;
}

function clampFpsValue(value: string | number) {
  return clampCineFps(value);
}

function clampFpsInput(event: Event) {
  const input = event.target as HTMLInputElement;
  fpsInput.value = input.value;
  if (fpsInput.value.trim() === '') return;

  const clamped = clampFpsValue(fpsInput.value);
  if (clamped == null) return;
  fps.value = clamped;
  fpsInput.value = String(clamped);
  input.value = fpsInput.value;
}

function commitFpsInput() {
  const clamped = clampFpsValue(fpsInput.value);
  const value = clamped ?? fps.value;
  fps.value = value;
  fpsInput.value = String(value);
}
</script>

<template>
  <div v-if="cine" class="play-controls pointer-events-all" @dblclick.stop>
    <button
      type="button"
      class="play-btn"
      :title="playing ? 'Pause' : 'Play'"
      :aria-pressed="playing"
      :aria-label="playing ? 'Pause cine playback' : 'Play cine playback'"
      @click="togglePlay"
    >
      <v-icon size="14">{{ playing ? 'mdi-pause' : 'mdi-play' }}</v-icon>
    </button>
    <input
      :value="fpsInput"
      type="number"
      :min="MIN_CINE_FPS"
      :max="MAX_CINE_FPS"
      class="fps-input"
      title="Frames per second"
      @input="clampFpsInput"
      @blur="commitFpsInput"
    />
    <span class="fps-suffix">fps</span>
  </div>
</template>

<style scoped>
.play-controls {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #fff;
  font-size: 0.8125rem;
  line-height: 1;
}

.play-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
}

.play-btn:hover {
  color: rgba(255, 255, 255, 0.8);
}

.fps-input {
  width: 44px;
  background: transparent;
  color: inherit;
  border: none;
  padding: 0 4px;
  text-align: right;
  font-size: inherit;
}

.fps-input:focus {
  outline: 1px solid rgba(255, 255, 255, 0.3);
}

.fps-suffix {
  opacity: 0.7;
}
</style>
