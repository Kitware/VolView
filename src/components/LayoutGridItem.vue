<script lang="ts" setup>
import ViewTypeSwitcher from '@/src/components/ViewTypeSwitcher.vue';
import CurrentImageProvider from '@/src/components/CurrentImageProvider.vue';
import { IMAGE_DRAG_MEDIA_TYPE } from '@/src/constants';
import { resolveViewRendering } from '@/src/core/viewTypes';
import { useViewStore } from '@/src/store/views';
import { computed, ref } from 'vue';

const props = defineProps<{ viewId: string }>();
const viewStore = useViewStore();
// used to keep track of the dragenter/dragleave count
const dragCounter = ref(0);
const showDropTarget = computed(() => dragCounter.value > 0);

const rendering = computed(() =>
  resolveViewRendering(viewStore.viewByID[props.viewId])
);

const activeStyles = computed(() => {
  if (showDropTarget.value) {
    return {
      border: '2px solid goldenrod',
    };
  }
  if (viewStore.activeView && viewStore.activeView === props.viewId) {
    return {
      border: '2px solid mediumseagreen',
    };
  }
  return {
    border: '2px solid rgba(255, 255, 255, 0.05)',
  };
});

function isValidDragEvent(event: DragEvent) {
  return event.dataTransfer?.types.includes(IMAGE_DRAG_MEDIA_TYPE);
}

function onDragEnter(event: DragEvent) {
  if (!isValidDragEvent(event)) return;
  dragCounter.value++;
  event.preventDefault();
}

function onDragLeave(event: DragEvent) {
  if (!isValidDragEvent(event)) return;
  event.preventDefault();
  dragCounter.value--;
}

function onDrop(event: DragEvent) {
  if (!isValidDragEvent(event)) return;
  event.preventDefault();
  dragCounter.value--;

  const droppedImageID = event.dataTransfer?.getData(IMAGE_DRAG_MEDIA_TYPE);
  if (droppedImageID) {
    viewStore.setDataForView(props.viewId, droppedImageID);
    viewStore.setActiveView(props.viewId);
  }
}
</script>

<template>
  <div
    class="grid-item"
    :style="activeStyles"
    @dragenter="onDragEnter"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div v-show="!rendering.renderImageID" class="overlay">
      <v-icon color="grey-darken-3" size="x-large">mdi-image-off</v-icon>
    </div>
    <CurrentImageProvider :image-id="rendering.renderImageID">
      <!-- The empty overlay hides the viewer, so its controls must not take focus. -->
      <component
        :is="rendering.component"
        :view-id="viewId"
        :inert="!rendering.renderImageID"
      />
    </CurrentImageProvider>
    <div
      v-if="!rendering.renderImageID"
      class="empty-view-controls"
      @click.stop
      @dblclick.stop
    >
      <ViewTypeSwitcher :view-id="viewId" :image-id="null" />
    </div>
  </div>
</template>

<style scoped>
.grid-item {
  position: relative;
  box-sizing: border-box;
}

.empty-view-controls {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding: 4px;
  pointer-events: none;
  z-index: 11;
}
.overlay {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 10;
  user-select: none;
  background-color: black;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
