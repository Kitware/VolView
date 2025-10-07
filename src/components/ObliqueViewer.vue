<template>
  <div class="oblique-grid">
    <div class="d-flex">
      <ObliqueSliceViewer
        :view-id="`${viewId}-coronal`"
        outline-type="ObliqueCoronal"
        view-direction="Posterior"
        view-up="Superior"
      />
    </div>
    <div class="d-flex">
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
    <div class="d-flex">
      <ObliqueSliceViewer
        :view-id="`${viewId}-sagittal`"
        outline-type="ObliqueSagittal"
        view-direction="Right"
        view-up="Superior"
      />
    </div>
    <div class="d-flex">
      <ObliqueSliceViewer
        :view-id="`${viewId}-axial`"
        outline-type="ObliqueAxial"
        view-direction="Superior"
        view-up="Anterior"
      />
    </div>
    <view-overlay-grid class="overlay-no-events view-annotations">
      <template #bottom-right>
        <div class="annotation-cell" @click.stop>
          <ViewTypeSwitcher :view-id="viewId" :image-id="currentImageID" />
        </div>
      </template>
    </view-overlay-grid>
  </div>
</template>

<script setup lang="ts">
import MultiObliqueSliceViewer from '@/src/components/MultiObliqueSliceViewer.vue';
import ObliqueSliceViewer from '@/src/components/ObliqueSliceViewer.vue';
import useResliceCursorStore from '@/src/store/reslice-cursor';
import ViewOverlayGrid from '@/src/components/ViewOverlayGrid.vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import ViewTypeSwitcher from '@/src/components/ViewTypeSwitcher.vue';

interface Props {
  viewId: string;
}

defineProps<Props>();

const { currentImageID } = useCurrentImage();

// initialize the reslice cursor store
useResliceCursorStore();
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
<style scoped src="@/src/components/styles/utils.css"></style>
<style scoped>
.oblique-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 1px;
  background-color: gray;
  flex: 1;
}

.oblique-grid > div {
  display: flex;
  min-width: 0;
  min-height: 0;
}
</style>
