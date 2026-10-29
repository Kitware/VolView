<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import ColorMapSelect from './ColorMapSelect.vue';
import DisplayRangeControl from './DisplayRangeControl.vue';

const props = withDefaults(
  defineProps<{
    imageName: string;
    preset: string;
    mappingRange: readonly [number, number];
    imageRange: readonly [number, number];
    visibility: boolean;
    unavailableReason: string;
    visibilityUnavailableReason: string;
    transparentBackground?: boolean;
    windowLevel?: boolean;
    closeOnContentClick?: boolean;
    testIdPrefix: string;
  }>(),
  { closeOnContentClick: true }
);

const emit = defineEmits<{
  'update:preset': [value: string];
  'update:mappingRange': [range: [number, number]];
  'toggle-visibility': [];
}>();

const controlsUnavailableReason = computed(() =>
  props.visibilityUnavailableReason ? props.unavailableReason : ''
);

const contrastOpen = ref(false);
const rangeControl = ref<InstanceType<typeof DisplayRangeControl>>();

watch(
  () => props.unavailableReason,
  (reason) => {
    if (reason) contrastOpen.value = false;
  }
);

async function resetRangeDrafts() {
  await nextTick();
  rangeControl.value?.resetDrafts();
}

defineExpose({ resetRangeDrafts });

function applyContrastRange(range: [number, number]) {
  emit('update:mappingRange', range);
  contrastOpen.value = false;
  resetRangeDrafts();
}
</script>

<template>
  <section :aria-label="imageName">
    <div class="d-flex align-center ga-3 mb-3">
      <v-tooltip :text="imageName" location="top">
        <template #activator="{ props: tooltipProps }">
          <h4 class="text-ellipsis" v-bind="tooltipProps">{{ imageName }}</h4>
        </template>
      </v-tooltip>
      <slot name="label" />
    </div>
    <v-tooltip
      :text="controlsUnavailableReason"
      :disabled="!controlsUnavailableReason"
    >
      <template #activator="{ props: controlsProps }">
        <div
          class="ms-4"
          :data-testid="`${testIdPrefix}-display-controls`"
          v-bind="controlsProps"
          :tabindex="controlsUnavailableReason ? 0 : undefined"
        >
          <div class="d-flex align-center ga-2">
            <v-tooltip
              :text="visibilityUnavailableReason"
              :disabled="!visibilityUnavailableReason"
            >
              <template #activator="{ props: tooltipProps }">
                <span
                  class="visibility-control"
                  v-bind="tooltipProps"
                  :tabindex="visibilityUnavailableReason ? 0 : undefined"
                >
                  <v-btn
                    size="small"
                    height="40"
                    width="88"
                    :prepend-icon="visibility ? 'mdi-eye' : 'mdi-eye-off'"
                    :aria-label="`${visibility ? 'Hide' : 'Show'} ${imageName}`"
                    :disabled="!!visibilityUnavailableReason"
                    :data-testid="`${testIdPrefix}-visibility`"
                    @click="$emit('toggle-visibility')"
                  >
                    {{ visibility ? 'Hide' : 'Show' }}
                  </v-btn>
                </span>
              </template>
            </v-tooltip>
            <v-tooltip :text="unavailableReason" :disabled="!unavailableReason">
              <template #activator="{ props: tooltipProps }">
                <div
                  class="colormap-control"
                  v-bind="tooltipProps"
                  :tabindex="unavailableReason ? 0 : undefined"
                >
                  <ColorMapSelect
                    :model-value="preset"
                    :disabled="!!unavailableReason"
                    :test-id-prefix="testIdPrefix"
                    @update:model-value="$emit('update:preset', $event)"
                  />
                </div>
              </template>
            </v-tooltip>
          </div>
          <v-tooltip :text="unavailableReason" :disabled="!unavailableReason">
            <template #activator="{ props: tooltipProps }">
              <div
                v-bind="tooltipProps"
                :tabindex="unavailableReason ? 0 : undefined"
              >
                <DisplayRangeControl
                  ref="rangeControl"
                  class="mt-1"
                  :model-value="mappingRange"
                  :data-range="imageRange"
                  :preset="preset"
                  :transparent-background="transparentBackground"
                  :disabled="!!unavailableReason"
                  :window-level="windowLevel"
                  :test-id-prefix="`${testIdPrefix}-range`"
                  @update:model-value="$emit('update:mappingRange', $event)"
                >
                  <template #actions>
                    <v-menu
                      v-model="contrastOpen"
                      :close-on-content-click="closeOnContentClick"
                      :disabled="!!unavailableReason"
                      location="bottom"
                    >
                      <template #activator="{ props: menuProps }">
                        <v-btn
                          v-bind="menuProps"
                          size="small"
                          height="40"
                          prepend-icon="mdi-circle-half-full"
                          append-icon="mdi-menu-down"
                          :disabled="!!unavailableReason"
                          :data-testid="`${testIdPrefix}-contrast`"
                        >
                          Contrast
                        </v-btn>
                      </template>
                      <slot
                        name="contrast"
                        :reset-range-drafts="resetRangeDrafts"
                        :apply-range="applyContrastRange"
                      />
                    </v-menu>
                  </template>
                </DisplayRangeControl>
              </div>
            </template>
          </v-tooltip>
          <slot />
        </div>
      </template>
    </v-tooltip>
  </section>
</template>

<style scoped>
.colormap-control {
  flex: 1;
  min-width: 0;
}
.visibility-control {
  flex-shrink: 0;
}
</style>
