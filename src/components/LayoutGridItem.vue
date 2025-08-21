<script lang="ts" setup>
import CurrentImageProvider from '@/src/components/CurrentImageProvider.vue';
import { IMAGE_DRAG_MEDIA_TYPE } from '@/src/constants';
import { getComponentFromViewInfo } from '@/src/core/viewTypes';
import { useViewStore } from '@/src/store/views';
import { computed, ref } from 'vue';

const props = defineProps<{ viewId: string }>();
const viewStore = useViewStore();
// used to keep track of the dragenter/dragleave count
const dragCounter = ref(0);
const showDropTarget = computed(() => dragCounter.value > 0);

const ItemComponent = computed(() => {
  const viewInfo = viewStore.viewByID[props.viewId];
  return getComponentFromViewInfo(viewInfo);
});

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

const imageID = computed(() => {
  const viewInfo = viewStore.viewByID[props.viewId];
  return viewInfo.dataID;
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
    <div v-show="!imageID" class="overlay">
      <v-icon color="grey-darken-3" size="x-large">mdi-image-off</v-icon>
    </div>
    <CurrentImageProvider :image-id="imageID">
      <ItemComponent :view-id="viewId" />
    </CurrentImageProvider>
  </div>
</template>

<style scoped>
.grid-item {
  position: relative;
  box-sizing: border-box;
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
