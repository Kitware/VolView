<script setup lang="ts">
import { computed, provide, shallowRef, useTemplateRef, watch } from 'vue';
import { useEventListener } from '@vueuse/core';
import type { Layout } from '@/src/types/layout';
import { useViewStore } from '@/src/store/views';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import {
  alignedDividers,
  axisOf,
  getLayoutDividers,
  getLayoutPanes,
  moveLayoutDividers,
  moveLayoutView,
  pickDropZone,
  resetLayoutDividers,
  type Bounds,
  type DropZone,
  type LayoutDivider,
} from '@/src/utils/layoutEditing';
import { ViewMoveKey } from '@/src/composables/useViewMove';
import LayoutGridItem from '@/src/components/LayoutGridItem.vue';

const props = defineProps<{ layout: Layout }>();
const viewStore = useViewStore();
const container = useTemplateRef<HTMLElement>('container');

type Capture = { pointerId: number; handle: HTMLElement };

const releaseCapture = ({ pointerId, handle }: Capture) => {
  if (handle.hasPointerCapture(pointerId))
    handle.releasePointerCapture(pointerId);
};

const percentStyle = ({ left, top, width, height }: Bounds) => ({
  left: `${left}%`,
  top: `${top}%`,
  width: `${width}%`,
  height: `${height}%`,
});

// Dragging renders from a local draft; the store sees one commit on release.
type Drag = Capture & {
  layout: Layout;
  dividers: LayoutDivider[];
  origin: number;
  position: number;
  container: { width: number; height: number };
  draft?: Layout;
};
const drag = shallowRef<Drag>();
const shown = computed(() => drag.value?.draft ?? props.layout);

const items = computed(() =>
  getLayoutPanes(shown.value).flatMap((pane) =>
    viewStore.getView(pane.viewId)
      ? [{ viewId: pane.viewId, style: percentStyle(pane) }]
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
    const along = axisOf(divider.direction);
    const across = axisOf(divider.direction === 'row' ? 'column' : 'row');
    return {
      divider,
      key: dividerKey(divider),
      orientation:
        divider.direction === 'row'
          ? ('vertical' as const)
          : ('horizontal' as const),
      style: {
        [along.start]: `calc(${divider.position}% - var(--divider-size) / 2)`,
        [across.start]: `${divider.start}%`,
        [along.size]: 'var(--divider-size)',
        [across.size]: `${divider.length}%`,
      },
    };
  })
);

const pointerAlong = (divider: LayoutDivider, event: PointerEvent) =>
  divider.direction === 'row' ? event.clientX : event.clientY;

function startDrag(divider: LayoutDivider, event: PointerEvent) {
  if (move.value || drag.value || !container.value || event.button !== 0)
    return;
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
  const span = current.container[axisOf(divider.direction).size];
  const moved = ((pointerAlong(divider, event) - current.origin) / span) * 100;
  drag.value = {
    ...current,
    draft: moveLayoutDividers(
      current.layout,
      current.dividers,
      current.position + moved,
      current.container
    ),
  };
}

// A canceled drag reverts, whether the browser or Escape ended it.
function endDrag(event: PointerEvent, commit: boolean) {
  const current = drag.value;
  if (event.pointerId !== current?.pointerId) return;
  if (commit && current.draft) viewStore.resizeLayout(current.draft);
  drag.value = undefined;
}

type MoveTarget = { viewId: string; zone: DropZone };
type Move = Capture & {
  viewId: string;
  container: DOMRect;
  target?: MoveTarget;
};
const move = shallowRef<Move>();

const sameTarget = (a?: MoveTarget, b?: MoveTarget) =>
  a?.viewId === b?.viewId && a?.zone === b?.zone;
const movingViewId = computed(() => move.value?.viewId);
const panes = computed(() => getLayoutPanes(props.layout));

// The moved view's pane in the layout the drop would commit.
const movePreview = computed(() => {
  const current = move.value;
  if (!current?.target) return undefined;
  const { viewId, zone } = current.target;
  const landed = getLayoutPanes(
    moveLayoutView(props.layout, current.viewId, viewId, zone)
  ).find((pane) => pane.viewId === current.viewId);
  return landed && percentStyle(landed);
});

function dropTarget({ viewId, container: rect }: Move, event: PointerEvent) {
  const { left, top, width, height } = rect;
  const point = {
    x: ((event.clientX - left) / width) * 100,
    y: ((event.clientY - top) / height) * 100,
  };
  const pane = panes.value.find(
    (bounds) =>
      point.x >= bounds.left &&
      point.x < bounds.left + bounds.width &&
      point.y >= bounds.top &&
      point.y < bounds.top + bounds.height
  );
  if (!pane || pane.viewId === viewId) return undefined;
  return {
    viewId: pane.viewId,
    zone: pickDropZone(pane, point, { width, height }),
  };
}

function endMove() {
  const current = move.value;
  if (!current) return;
  move.value = undefined;
  releaseCapture(current);
}

function onMovePointer(event: PointerEvent) {
  const current = move.value;
  if (!current || event.pointerId !== current.pointerId) return;
  if (event.type === 'pointermove') {
    const target = dropTarget(current, event);
    if (!sameTarget(target, current.target))
      move.value = { ...current, target };
    return;
  }
  if (event.type === 'pointerup' && current.target)
    viewStore.moveView(
      current.viewId,
      current.target.viewId,
      current.target.zone
    );
  endMove();
}

useEventListener(
  () => move.value?.handle,
  ['pointermove', 'pointerup', 'pointercancel', 'lostpointercapture'],
  onMovePointer
);
// A handle removed mid-move loses its capture at the document.
useEventListener(document, 'lostpointercapture', onMovePointer);

function startMove(viewId: string, event: PointerEvent) {
  if (move.value || drag.value || !container.value || event.button !== 0)
    return;
  event.preventDefault();
  const handle = event.currentTarget as HTMLElement;
  handle.setPointerCapture(event.pointerId);
  move.value = {
    viewId,
    pointerId: event.pointerId,
    handle,
    container: container.value.getBoundingClientRect(),
  };
}

provide(ViewMoveKey, { movingViewId, start: startMove });

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return;
  endMove();
  const current = drag.value;
  if (!current) return;
  drag.value = undefined;
  releaseCapture(current);
});

watch(
  () => props.layout,
  () => {
    if (drag.value?.layout !== props.layout) drag.value = undefined;
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
      :class="{ 'layout-item--moving': movingViewId === item.viewId }"
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
    <div v-if="movePreview" class="layout-drop-preview" :style="movePreview" />
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
.layout-item--moving {
  opacity: 0.5;
}
.layout-drop-preview {
  position: absolute;
  z-index: 30;
  pointer-events: none;
  box-sizing: border-box;
  border: 2px solid rgb(var(--v-theme-primary));
  background-color: rgba(var(--v-theme-primary), 0.25);
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
