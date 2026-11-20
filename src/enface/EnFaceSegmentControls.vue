<script setup lang="ts">
import { computed } from 'vue';
import ReasonedAction from '@/src/components/ReasonedAction.vue';
import ColorDot from '@/src/components/ColorDot.vue';
import ListItemRow from '@/src/components/ListItemRow.vue';
import { EN_FACE_THICKNESS_HELP } from './thickness';
import {
  defaultSegmentProjection,
  type EnFaceViewConfig,
  type SegmentControlState,
  type SegmentProjection,
} from './store';

const props = defineProps<
  SegmentControlState & { settings: EnFaceViewConfig; embedded?: boolean }
>();
const emit = defineEmits<{
  segment: [segmentId: string, patch: Partial<SegmentProjection>];
}>();
const rows = computed(() =>
  props.segments.map((segment) => {
    const projection =
      props.settings.segmentProjections[segment.id] ??
      defaultSegmentProjection();
    return {
      ...segment,
      projection,
      shown: projection.visible && !segment.listHidden,
      reason:
        props.segmentationReason ??
        (segment.listHidden
          ? 'Hidden in the Annotations segment list.'
          : undefined),
    };
  })
);
// The Annotations list owns the eyes of segments it hides.
const showable = computed(() => rows.value.filter((row) => !row.listHidden));
const allVisible = computed(
  () =>
    showable.value.length > 0 &&
    showable.value.every((row) => row.projection.visible)
);
const showAllReason = computed(
  () =>
    props.segmentationReason ??
    (showable.value.length
      ? undefined
      : 'Every segment is hidden in the Annotations segment list.')
);
function setAllVisible(visible: boolean) {
  showable.value.forEach((row) => emit('segment', row.id, { visible }));
}
function updateThreshold(segmentId: string, value: string | number | null) {
  if (value === null || value === '') {
    emit('segment', segmentId, { thresholdMicrons: null });
    return;
  }
  const parsed = Number(value);
  if (Number.isFinite(parsed))
    emit('segment', segmentId, { thresholdMicrons: Math.max(0, parsed) });
}
// The slider's right end keeps every region.
function slideThreshold(segmentId: string, value: number, maximum: number) {
  emit('segment', segmentId, {
    thresholdMicrons: value >= maximum ? null : Math.round(value * 10) / 10,
  });
}
</script>

<template>
  <v-expansion-panel
    bg-color="transparent"
    class="segments-panel"
    :class="{ embedded }"
  >
    <v-expansion-panel-title
      class="section-title"
      :min-height="36"
      data-testid="enface-segments-toggle"
      >Segments</v-expansion-panel-title
    >
    <ReasonedAction
      class="header-actions"
      :reason="showAllReason"
      :tooltip="allVisible ? 'Hide every segment' : 'Show every segment'"
      v-slot="{ disabled }"
    >
      <v-btn
        icon
        size="small"
        density="compact"
        variant="plain"
        :disabled="disabled"
        :aria-label="allVisible ? 'Hide every segment' : 'Show every segment'"
        data-testid="enface-segments-visible"
        @click.stop="setAllVisible(!allVisible)"
      >
        <v-icon>{{ allVisible ? 'mdi-eye' : 'mdi-eye-off' }}</v-icon>
      </v-btn>
    </ReasonedAction>
    <v-expansion-panel-text>
      <div
        v-if="segmentationReason"
        class="text-caption text-medium-emphasis"
        data-testid="enface-segments-reason"
      >
        {{ segmentationReason }}
      </div>
      <v-list
        v-if="rows.length"
        density="compact"
        bg-color="transparent"
        class="segment-rows py-0"
      >
        <div
          v-for="row in rows"
          :key="row.id"
          class="segment-row"
          data-testid="enface-segment-row"
          :data-segment-name="row.title"
          v-memo="[
            row.title,
            row.color,
            row.thresholdMaximum,
            row.projection,
            row.listHidden,
            row.reason,
            thinReason,
          ]"
        >
          <list-item-row :name="row.title">
            <template #prepend>
              <span class="dot-container mr-3">
                <ColorDot
                  v-if="row.color"
                  :color="row.color"
                  aria-hidden="true"
                  data-testid="enface-segment-color"
                />
              </span>
            </template>
            <template #append>
              <ReasonedAction
                :reason="row.reason"
                :tooltip="row.projection.visible ? 'Hide' : 'Show'"
                v-slot="{ disabled }"
              >
                <v-btn
                  icon
                  size="small"
                  density="compact"
                  variant="plain"
                  :disabled="disabled"
                  :aria-pressed="row.shown"
                  :aria-label="`Show ${row.title} on the en face view`"
                  data-testid="enface-segment-visible"
                  @click="
                    emit('segment', row.id, {
                      visible: !row.projection.visible,
                    })
                  "
                >
                  <v-icon>{{ row.shown ? 'mdi-eye' : 'mdi-eye-off' }}</v-icon>
                </v-btn>
              </ReasonedAction>
            </template>
          </list-item-row>
          <!-- The list would take Home, End and arrows to move row focus. -->
          <div
            v-if="row.projection.visible && !thinReason && !row.reason"
            class="threshold-line"
            @keydown.home.end.up.down.stop
          >
            <span
              class="threshold-label text-caption text-medium-emphasis text-no-wrap"
              >Thinner than
              <v-tooltip
                activator="parent"
                location="top"
                max-width="320"
                :text="`Show only regions thinner than this. ${EN_FACE_THICKNESS_HELP}`"
            /></span>
            <ReasonedAction
              :reason="
                row.thresholdMaximum === null
                  ? 'The thickness range appears once the segment is shown and measured.'
                  : undefined
              "
              class="threshold-slider"
              block
              v-slot="{ disabled }"
            >
              <v-slider
                :model-value="
                  Math.min(
                    row.projection.thresholdMicrons ?? Infinity,
                    row.thresholdMaximum ?? 0
                  )
                "
                @update:model-value="
                  slideThreshold(row.id, $event, row.thresholdMaximum ?? 0)
                "
                min="0"
                :max="row.thresholdMaximum ?? 0"
                :step="0"
                density="compact"
                hide-details
                :disabled="disabled"
                :name="`Thickness threshold of ${row.title} in micrometers`"
                data-testid="enface-segment-threshold"
              />
            </ReasonedAction>
            <v-text-field
              :model-value="row.projection.thresholdMicrons ?? ''"
              @update:model-value="updateThreshold(row.id, $event)"
              type="number"
              min="0"
              step="any"
              placeholder="Any"
              persistent-placeholder
              suffix="µm"
              density="compact"
              variant="outlined"
              hide-details
              class="threshold-value"
              :aria-label="`Thickness threshold of ${row.title} in micrometers`"
              data-testid="enface-segment-threshold-input"
            />
          </div>
        </div>
      </v-list>
      <div
        v-if="thinReason && !segmentationReason && rows.length"
        class="text-caption text-medium-emphasis pt-1"
        data-testid="enface-thin-reason"
      >
        Thickness filtering is unavailable. {{ thinReason }}
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.segments-panel {
  position: relative;
}
.section-title {
  padding: 0 4px;
  font-size: 0.8125rem;
}
.header-actions {
  position: absolute;
  z-index: 1;
  /* Centered on the 36px title; clears the chevron, lines up with row eyes. */
  inset-block-start: 18px;
  inset-inline-end: 32px;
  transform: translateY(-50%);
}
.segment-rows {
  max-height: 232px;
  overflow-y: auto;
  scrollbar-width: thin;
}
.embedded .segment-rows {
  max-height: 320px;
}
.dot-container {
  display: inline-flex;
  width: 18px;
}
.segment-row {
  container-type: inline-size;
}
.threshold-line {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) 104px;
  grid-template-areas: 'label slider value';
  align-items: center;
  column-gap: 8px;
  padding: 0 4px 6px 34px;
}
/* Below this the slider would be too short to drag precisely. */
@container (max-width: 380px) {
  .threshold-line {
    grid-template-columns: minmax(0, 1fr) 104px;
    grid-template-areas: 'label value' 'slider slider';
  }
}
.threshold-label {
  grid-area: label;
}
.threshold-slider {
  grid-area: slider;
}
.threshold-value {
  grid-area: value;
}
</style>
