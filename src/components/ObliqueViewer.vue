<template>
  <div class="d-flex flex-row flex-grow-1">
    <div class="d-flex flex-column flex-grow-1">
      <div class="d-flex flex-grow-1" style="border-bottom: 1px solid gray">
        <ObliqueSliceViewer
          :view-id="`${viewId}-coronal`"
          outline-type="ObliqueCoronal"
          view-direction="Posterior"
          view-up="Superior"
        />
      </div>
      <div class="d-flex flex-grow-1" style="border-right: 1px solid gray">
        <ObliqueSliceViewer
          :view-id="`${viewId}-sagittal`"
          outline-type="ObliqueSagittal"
          view-direction="Right"
          view-up="Superior"
        />
      </div>
    </div>
    <div class="d-flex flex-column flex-grow-1">
      <div class="d-flex flex-grow-1" style="border-left: 1px solid gray">
        <MultiObliqueSliceViewer
          :view-id="`${viewId}-multi-oblique`"
          view-direction="Posterior"
          view-up="Superior"
          :slices="[
            {
              viewID: `${viewId}-coronal`,
              axis: 'Coronal',
            },
            {
              viewID: `${viewId}-sagittal`,
              axis: 'Sagittal',
            },
            {
              viewID: `${viewId}-axial`,
              axis: 'Axial',
            },
          ]"
        />
      </div>
      <div class="d-flex flex-grow-1" style="border-top: 1px solid gray">
        <ObliqueSliceViewer
          :view-id="`${viewId}-axial`"
          outline-type="ObliqueAxial"
          view-direction="Superior"
          view-up="Anterior"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import MultiObliqueSliceViewer from '@/src/components/MultiObliqueSliceViewer.vue';
import ObliqueSliceViewer from '@/src/components/ObliqueSliceViewer.vue';
import useResliceCursorStore from '@/src/store/reslice-cursor';

interface Props {
  viewId: string;
}

defineProps<Props>();

// initialize the reslice cursor store
useResliceCursorStore();
</script>
