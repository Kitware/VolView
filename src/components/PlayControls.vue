<script setup lang="ts">
import { computed, ref, toRefs, watch } from 'vue';
import { useIntervalFn } from '@vueuse/core';
import { Maybe } from '@/src/types';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import { getCineImage } from '@/src/core/cine/isCineImage';

type Props = {
  viewId: string;
  imageId: Maybe<string>;
};

const props = defineProps<Props>();
const { imageId, viewId } = toRefs(props);

const cine = computed(() => getCineImage(imageId.value));
const { slice, range } = useSliceConfig(viewId, imageId);

const playing = ref(false);
const fps = ref(0);

watch(
  cine,
  (image) => {
    if (!image) {
      fps.value = 0;
      return;
    }
    const frameTime = image.header.frameTimeMs;
    fps.value = frameTime && frameTime > 0 ? Math.round(1000 / frameTime) : 24;
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

watch(playing, (isPlaying) => {
  if (isPlaying) resume();
  else pause();
});

// Pause when the cine clip changes (or is removed).
watch(imageId, () => {
  playing.value = false;
});

const MIN_FPS = 1;
const MAX_FPS = 120;

function togglePlay() {
  playing.value = !playing.value;
}

function clampFps() {
  if (!Number.isFinite(fps.value) || fps.value < MIN_FPS) fps.value = MIN_FPS;
  else if (fps.value > MAX_FPS) fps.value = MAX_FPS;
  else fps.value = Math.round(fps.value);
}
</script>

<template>
  <div v-if="cine" class="play-controls pointer-events-all">
    <button
      type="button"
      class="play-btn"
      :title="playing ? 'Pause' : 'Play'"
      @click="togglePlay"
    >
      <v-icon size="14">{{ playing ? 'mdi-pause' : 'mdi-play' }}</v-icon>
    </button>
    <input
      v-model.number="fps"
      type="number"
      :min="MIN_FPS"
      :max="MAX_FPS"
      class="fps-input"
      title="Frames per second"
      @change="clampFps"
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
