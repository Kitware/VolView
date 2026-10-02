<script setup lang="ts">
import { computed, shallowRef, useTemplateRef, watch } from 'vue';
import { useEventListener } from '@vueuse/core';
import type { Layout } from '@/src/types/layout';
import { useViewStore } from '@/src/store/views';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import {
  alignedDividers,
  getLayoutDividers,
  getLayoutPanes,
  moveLayoutDividers,
  resetLayoutDividers,
  type LayoutDivider,
} from '@/src/utils/layoutEditing';
import LayoutGridItem from '@/src/components/LayoutGridItem.vue';

const props = defineProps<{ layout: Layout }>();
const viewStore = useViewStore();
const container = useTemplateRef<HTMLElement>('container');

// Dragging renders from a local draft; the store sees one commit on release.
type Drag = {
  pointerId: number;
  handle: HTMLElement;
  layout: Layout;
  dividers: LayoutDivider[];
  origin: number;
  position: number;
  container: { width: number; height: number };
};
const drag = shallowRef<Drag>();
const draft = shallowRef<Layout>();
const shown = computed(() => draft.value ?? props.layout);

const items = computed(() =>
  getLayoutPanes(shown.value).flatMap(({ viewId, left, top, width, height }) =>
    viewStore.getView(viewId)
      ? [
          {
            viewId,
            style: {
              left: `${left}%`,
              top: `${top}%`,
              width: `${width}%`,
              height: `${height}%`,
            },
          },
        ]
      : []
  )
);

const dividerKey = (divider: LayoutDivider) =>
  `${divider.path.join('.')}:${divider.index}`;
const dragged = computed(
  () => new Set(drag.value?.dividers.map(dividerKey) ?? [])
);

const dividers = computed(() =>
  getLayoutDividers(shown.value).map((divider) => {
    const vertical = divider.direction === 'row';
    const [along, across] = vertical ? ['left', 'top'] : ['top', 'left'];
    const [thickness, extent] = vertical
      ? ['width', 'height']
      : ['height', 'width'];
    return {
      divider,
      key: dividerKey(divider),
      orientation: vertical ? ('vertical' as const) : ('horizontal' as const),
      style: {
        [along]: `calc(${divider.position}% - var(--divider-size) / 2)`,
        [across]: `${divider.start}%`,
        [thickness]: 'var(--divider-size)',
        [extent]: `${divider.length}%`,
      },
    };
  })
);

const pointerAlong = (divider: LayoutDivider, event: PointerEvent) =>
  divider.direction === 'row' ? event.clientX : event.clientY;

function startDrag(divider: LayoutDivider, event: PointerEvent) {
  if (drag.value || !container.value || event.button !== 0) return;
  event.preventDefault();
  const handle = event.currentTarget as HTMLElement;
  handle.setPointerCapture(event.pointerId);
  const { width, height } = container.value.getBoundingClientRect();
  drag.value = {
    pointerId: event.pointerId,
    handle,
    layout: props.layout,
    dividers: alignedDividers(getLayoutDividers(props.layout), divider),
    origin: pointerAlong(divider, event),
    position: divider.position,
    container: { width, height },
  };
}

function moveDrag(event: PointerEvent) {
  const current = drag.value;
  if (!current || event.pointerId !== current.pointerId) return;
  const [divider] = current.dividers;
  const span =
    divider.direction === 'row'
      ? current.container.width
      : current.container.height;
  const moved = ((pointerAlong(divider, event) - current.origin) / span) * 100;
  draft.value = moveLayoutDividers(
    current.layout,
    current.dividers,
    current.position + moved,
    current.container
  );
}

// A canceled drag reverts, whether the browser or Escape ended it.
function endDrag(event: PointerEvent, commit: boolean) {
  if (event.pointerId !== drag.value?.pointerId) return;
  if (commit && draft.value) viewStore.resizeLayout(draft.value);
  drag.value = undefined;
  draft.value = undefined;
}

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  const current = drag.value;
  if (event.key !== 'Escape' || !current) return;
  drag.value = undefined;
  draft.value = undefined;
  current.handle.releasePointerCapture(current.pointerId);
});

watch(
  () => props.layout,
  () => {
    if (drag.value?.layout === props.layout) return;
    drag.value = undefined;
    draft.value = undefined;
  }
);

function resetSizes(divider: LayoutDivider) {
  const layout = props.layout;
  viewStore.resizeLayout(
    resetLayoutDividers(
      layout,
      alignedDividers(getLayoutDividers(layout), divider)
    )
  );
}

function maximize(id: string) {
  if (useToolStore().currentTool !== Tools.Polygon) {
    viewStore.setActiveView(id);
    viewStore.toggleActiveViewMaximized();
  }
}
</script>

<template>
  <div ref="container" class="layout-container flex-equal">
    <LayoutGridItem
      v-for="item in items"
      :key="item.viewId"
      class="layout-item"
      :style="item.style"
      :view-id="item.viewId"
      @pointerdown.capture="viewStore.setActiveView(item.viewId)"
      @dblclick="maximize(item.viewId)"
    />
    <div
      v-for="handle in dividers"
      :key="handle.key"
      class="layout-divider"
      :class="{
        'layout-divider--vertical': handle.orientation === 'vertical',
        'layout-divider--dragging': dragged.has(handle.key),
      }"
      role="separator"
      aria-label="Resize views"
      :aria-orientation="handle.orientation"
      :style="handle.style"
      @pointerdown="startDrag(handle.divider, $event)"
      @pointermove="moveDrag"
      @pointerup="endDrag($event, true)"
      @pointercancel="endDrag($event, false)"
      @lostpointercapture="endDrag($event, false)"
      @dblclick.stop="resetSizes(handle.divider)"
    />
  </div>
</template>

<style scoped src="@/src/components/styles/utils.css"></style>
<style scoped>
.layout-container {
  --divider-size: 10px;
  position: relative;
  min-height: 0;
}
.layout-item {
  position: absolute;
  display: flex;
  min-width: 0;
  min-height: 0;
}
.layout-divider {
  position: absolute;
  z-index: 20;
  touch-action: none;
  cursor: row-resize;
}
.layout-divider--vertical {
  cursor: col-resize;
}
.layout-divider::after {
  content: '';
  position: absolute;
  inset: calc(50% - 1px) 0;
  transition: background-color 0.1s;
}
.layout-divider--vertical::after {
  inset: 0 calc(50% - 1px);
}
.layout-divider:hover::after {
  background-color: rgba(var(--v-theme-primary), 0.6);
}
.layout-divider--dragging::after,
.layout-divider--dragging:hover::after {
  background-color: rgb(var(--v-theme-primary));
}
</style>
