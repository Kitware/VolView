<script setup lang="ts">
import { computed } from 'vue';
import { useImageCacheStore } from '@/src/store/image-cache';

const imageID = defineModel<string | null>({ required: true });
const cache = useImageCacheStore();
const image = computed(() => cache.getImageMetadata(imageID.value));
const spatial = computed(() => image.value?.spatialMetadata);
const rows = computed(
  () =>
    spatial.value?.axes.map((axis, index) => ({
      ...axis,
      label: ['X', 'Y', 'Z'][index],
      value: Number(axis.value.toPrecision(7)).toString(),
      singleton: image.value?.dimensions[index] === 1,
    })) ?? []
);
const statuses = {
  declared: 'Declared',
  derived: 'Derived',
  fallback: 'Assumed',
};
const geometryReasons: Record<string, string> = {
  'unreadable-geometry': 'Spatial placement could not be established.',
  'repeated-position': 'Multiple slices occupy the same position.',
  'uneven-slice-spacing': 'Slices are not evenly spaced.',
  'in-plane-shift': 'Slices shift within their plane.',
  'mixed-pixel-spacing': 'Slices have different in-plane spacing.',
};
const reconstruction = computed(() => spatial.value?.reconstruction);
</script>

<template>
  <v-dialog
    :model-value="imageID !== null"
    max-width="680"
    @update:model-value="!$event && (imageID = null)"
  >
    <v-card data-testid="image-spacing-details">
      <v-card-title>Image spacing</v-card-title>
      <v-card-text>
        <template v-if="spatial">
          <p class="mb-3">
            Spacing follows the image's X, Y and Z axes. Declared values come
            from the file; derived values come from slice positions.
          </p>
          <v-table density="compact">
            <thead>
              <tr>
                <th>Axis</th>
                <th>Step</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in rows"
                :key="row.label"
                :data-testid="`spacing-axis-${row.label}`"
              >
                <td>
                  {{ row.label }}
                  <div v-if="row.singleton" class="text-caption">
                    One sample
                  </div>
                </td>
                <td>
                  {{ row.value }}
                  {{ row.unit === 'mm' ? 'mm' : '(physical unit unknown)' }}
                </td>
                <td>
                  {{ statuses[row.status] }}: {{ row.source }}
                  <div v-if="row.reason" class="text-caption">
                    {{ row.reason }}
                  </div>
                </td>
              </tr>
            </tbody>
          </v-table>
          <p
            v-if="rows.some((row) => row.unit === 'unknown' && !row.singleton)"
            class="mt-3"
          >
            Assumed steps position pixels for display. They do not establish a
            physical distance.
          </p>
          <p v-if="reconstruction?.kind === 'irregular'" class="mt-3">
            {{ geometryReasons[reconstruction.reason ?? ''] }} The displayed
            grid is approximate; measurements across slices may not represent
            physical distances.
          </p>
          <p v-for="note in spatial.notes" :key="note" class="mt-3">
            {{ note }}
          </p>
          <p v-if="spatial.calibration" class="mt-3">
            File calibration: {{ spatial.calibration.type }}
            {{ spatial.calibration.description }}
          </p>
        </template>
        <p v-else>
          The image reader has not reported how its physical spacing was
          established.
        </p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn data-testid="spacing-details-close" @click="imageID = null"
          >Close</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
