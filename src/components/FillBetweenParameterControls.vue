<template>
  <div class="d-flex align-center">
    <mini-expansion-panel>
      <template #title> Interpolate segmentation between slices. </template>
      <ul>
        <li>
          Will only fill between segmented slices where none of their direct
          neighbors are segmented.
        </li>
        <li>Only the selected segment will be filled between.</li>
        <li>
          Uses
          <a
            href="https://insight-journal.org/browse/publication/977"
            target="_blank"
          >
            morphological contour interpolation
          </a>
          method.
        </li>
      </ul>
    </mini-expansion-panel>
  </div>
</template>

<script setup lang="ts">
import MiniExpansionPanel from './MiniExpansionPanel.vue';
</script>
