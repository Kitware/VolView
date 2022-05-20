import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { ref } from '@vue/composition-api';
import { vec3 } from 'gl-matrix';
import { defineStore } from 'pinia';
import { useLabelmapStore } from '../datasets-labelmaps';

export const usePaintToolStore = defineStore('paint', () => {
  type _This = ReturnType<typeof usePaintToolStore>;

  const activeLabelmapID = ref<string | null>(null);
  const brushSize = ref(8);
  const brushValue = ref(1);
  const strokePoints = ref<vec3[]>([]);
  const labelmapOpacity = ref(1);

  function getWidgetFactory(this: _This) {
    return this.$tools.paint.factory;
  }

  // --- actions --- //

  function setup(this: _This) {
    const { currentImageID } = useCurrentImage();
    const imageID = currentImageID.value;
    if (!imageID) {
      return false;
    }
    // eslint-disable-next-line no-use-before-define
    selectOrCreateLabelmap(imageID);
    this.$tools.paint.setBrushSize(this.brushSize);
    return true;
  }

  function teardown() {
    activeLabelmapID.value = null;
  }

  function selectOrCreateLabelmap(imageID: string) {
    if (!imageID) {
      activeLabelmapID.value = null;
      return;
    }

    const labelmapStore = useLabelmapStore();
    const found = Object.entries(labelmapStore.parentImage).find(
      ([, parentID]) => imageID === parentID
    );
    if (found) {
      [activeLabelmapID.value] = found;
    } else {
      activeLabelmapID.value = labelmapStore.newLabelmapFromImage(imageID);
    }
  }
  function setBrushSize(this: _This, size: number) {
    brushSize.value = Math.round(size);
    this.$tools.paint.setBrushSize(size);
  }
  function setBrushValue(this: _This, value: number) {
    brushValue.value = value;
    this.$tools.paint.setBrushValue(value);
  }
  function setLabelmapOpacity(opacity: number) {
    if (opacity >= 0 && opacity <= 1) {
      labelmapOpacity.value = opacity;
    }
  }

  function doPaintStroke(this: _This, axisIndex: 0 | 1 | 2) {
    if (!activeLabelmapID.value) {
      return;
    }

    const labelmapStore = useLabelmapStore();
    const labelmap = labelmapStore.labelmaps[activeLabelmapID.value];
    if (!labelmap) {
      return;
    }

    const lastIndex = strokePoints.value.length - 1;
    if (lastIndex >= 0) {
      const lastPoint = strokePoints.value[lastIndex];
      const prevPoint =
        lastIndex >= 1 ? strokePoints.value[lastIndex - 1] : undefined;
      this.$tools.paint.paintLabelmap(
        labelmap,
        axisIndex,
        lastPoint,
        prevPoint
      );
    }
  }

  function startStroke(this: _This, indexPoint: vec3, axisIndex: 0 | 1 | 2) {
    strokePoints.value = [vec3.clone(indexPoint)];
    doPaintStroke.call(this, axisIndex);
  }

  function placeStrokePoint(
    this: _This,
    indexPoint: vec3,
    axisIndex: 0 | 1 | 2
  ) {
    strokePoints.value.push(indexPoint);
    doPaintStroke.call(this, axisIndex);
  }

  function endStroke(this: _This, indexPoint: vec3, axisIndex: 0 | 1 | 2) {
    strokePoints.value.push(indexPoint);
    doPaintStroke.call(this, axisIndex);
  }

  return {
    // state
    activeLabelmapID,
    brushSize,
    brushValue,
    strokePoints,
    labelmapOpacity,

    // actions and getters
    getWidgetFactory,
    setup,
    teardown,
    selectOrCreateLabelmap,
    setBrushSize,
    setBrushValue,
    setLabelmapOpacity,
    startStroke,
    placeStrokePoint,
    endStroke,
  };
});
