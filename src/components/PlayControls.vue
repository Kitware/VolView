<script setup lang="ts">
import { computed, ref, toRefs, watch } from 'vue';
import { useIntervalFn } from '@vueuse/core';
import { Maybe } from '@/src/types';
import { useCineFrame } from '@/src/composables/useCineFrame';
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
const { frame, frameRange, setFrame } = useCineFrame(viewId, imageId);
const playbackStore = useCinePlaybackStore();

const playbackConfig = computed(() =>
  playbackStore.getConfig(viewId.value, imageId.value)
);

function patchConfig(
  clipId: Maybe<string>,
  patch: Parameters<typeof playbackStore.updateConfig>[2]
) {
  if (!clipId) return;
  playbackStore.updateConfig(viewId.value, clipId, patch);
}

const playing = computed({
  get: () => playbackConfig.value.playing,
  set: (value: boolean) => patchConfig(imageId.value, { playing: value }),
});

const fps = computed({
  get: () => playbackConfig.value.fps,
  set: (value: number) => patchConfig(imageId.value, { fps: value }),
});

const period = computed(() => Math.round(1000 / fps.value));

const { pause, resume } = useIntervalFn(
  () => {
    const [min, max] = frameRange.value;
    if (max <= min) return;
    const next = frame.value + 1;
    setFrame(next > max ? min : next);
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

// Pause both sides on clip switch so an incoming clip with stored playing=true
// doesn't auto-resume.
watch(imageId, (nextImageId, previousImageId) => {
  if (nextImageId === previousImageId) return;
  patchConfig(previousImageId, { playing: false });
  patchConfig(nextImageId, { playing: false });
});

const fpsInput = ref(String(fps.value));
watch(fps, (value) => {
  fpsInput.value = String(value);
});

function clampFpsInput(event: Event) {
  const input = event.target as HTMLInputElement;
  fpsInput.value = input.value;
  if (fpsInput.value.trim() === '') return;

  const clamped = clampCineFps(fpsInput.value);
  if (clamped == null) return;
  fps.value = clamped;
  fpsInput.value = String(clamped);
  input.value = fpsInput.value;
}

function commitFpsInput() {
  const clamped = clampCineFps(fpsInput.value) ?? fps.value;
  fps.value = clamped;
  fpsInput.value = String(clamped);
}

function togglePlay() {
  playing.value = !playing.value;
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
    <span class="fps-control">
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
      <span class="fps-suffix">FPS</span>
    </span>
  </div>
</template>

<style scoped>
.play-controls {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #fff;
  font-size: inherit;
  line-height: inherit;
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
  opacity: 1;
}

.play-btn :deep(.v-icon) {
  opacity: 1;
}

.play-btn:hover {
  color: rgba(255, 255, 255, 0.8);
}

.fps-control {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.fps-input {
  width: 44px;
  background: transparent;
  color: inherit;
  border: none;
  padding: 0 4px;
  text-align: right;
  font: inherit;
  opacity: 1;
}

.fps-input:focus {
  outline: 1px solid rgba(255, 255, 255, 0.3);
}

.fps-suffix {
  opacity: 1;
}
</style>
