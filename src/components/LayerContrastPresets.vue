<script setup lang="ts">
import { computed } from 'vue';
import { WLAutoRanges } from '@/src/constants';
import { useImageStatsStore } from '@/src/store/image-stats';
import { isValidDisplayRange } from '@/src/utils/isValidDisplayRange';

const props = defineProps<{
  imageId: string;
  imageName: string;
  imageRange: readonly [number, number];
  unavailableReason: string;
}>();

const emit = defineEmits<{ select: [range: [number, number]] }>();
const imageStatsStore = useImageStatsStore();

const contrastOptions = computed(() => {
  const autoRanges = imageStatsStore.getAutoRangeValues(props.imageId);
  return Object.keys(WLAutoRanges).map((key) => {
    const range = key === 'FullRange' ? props.imageRange : autoRanges[key];
    const unavailable =
      props.unavailableReason ||
      (!isValidDisplayRange(props.imageRange)
        ? 'Contrast requires a finite, nonconstant image range.'
        : !range
          ? 'Image statistics are still being computed.'
          : !isValidDisplayRange(range)
            ? 'This contrast setting does not have a finite, nonconstant range.'
            : '');
    return {
      key,
      label: key.replace(/([A-Z])/g, ' $1').trim(),
      range,
      unavailable,
    };
  });
});

function selectContrast(key: string) {
  const option = contrastOptions.value.find(
    (candidate) => candidate.key === key
  );
  if (!option || option.unavailable || !isValidDisplayRange(option.range))
    return;
  emit('select', [option.range[0], option.range[1]]);
}
</script>

<template>
  <v-list
    density="compact"
    :aria-label="`${imageName} contrast`"
    data-testid="layer-contrast-menu"
  >
    <v-tooltip
      v-for="option in contrastOptions"
      :key="option.key"
      :text="option.unavailable"
      :disabled="!option.unavailable"
    >
      <template #activator="{ props: optionProps }">
        <div
          v-bind="optionProps"
          :tabindex="option.unavailable ? 0 : undefined"
        >
          <v-list-item
            :title="option.label"
            :disabled="!!option.unavailable"
            :data-testid="`layer-contrast-${option.key}`"
            @click="selectContrast(option.key)"
          />
        </div>
      </template>
    </v-tooltip>
  </v-list>
</template>
