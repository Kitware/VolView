import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { BrushTypes } from '@/src/core/tools/paint';
import { vec3 } from 'gl-matrix';
import { defineStore } from 'pinia';
import { useLabelmapStore } from '../datasets-labelmaps';

interface State {
  activeLabelmapID: string | null;
  brushType: BrushTypes;
  brushSize: number;
  brushValue: number;
  strokePoints: vec3[];
}

export const usePaintToolStore = defineStore('paint', {
  state: (): State => ({
    activeLabelmapID: null,
    brushType: BrushTypes.Circle,
    brushSize: 8,
    brushValue: 1,
    strokePoints: [],
  }),
  getters: {
    getWidgetFactory() {
      return () => this.$tools.paint.factory;
    },
  },
  actions: {
    setup() {
      const labelmapStore = useLabelmapStore();
      const { currentImageID } = useCurrentImage();
      const imageID = currentImageID.value;
      if (!imageID) {
        return false;
      }

      const found = Object.entries(labelmapStore.parentImage).find(
        ([, parentID]) => imageID === parentID
      );
      if (found) {
        [this.activeLabelmapID] = found;
      } else {
        this.activeLabelmapID = labelmapStore.newLabelmapFromImage(imageID);
      }

      this.$tools.paint.setBrushSize(this.brushSize);

      return true;
    },
    teardown() {
      this.activeLabelmapID = null;
    },
    setBrushSize(size: number) {
      this.brushSize = Math.round(size);
      this.$tools.paint.setBrushSize(size);
    },
    setBrushValue(value: number) {
      this.brushValue = value;
      this.$tools.paint.setBrushValue(value);
    },
    _doPaintStroke(axisIndex: 0 | 1 | 2) {
      if (!this.activeLabelmapID) {
        return;
      }

      const labelmapStore = useLabelmapStore();
      const labelmap = labelmapStore.labelmaps[this.activeLabelmapID];
      if (!labelmap) {
        return;
      }

      const lastIndex = this.strokePoints.length - 1;
      if (lastIndex >= 0) {
        const lastPoint = this.strokePoints[lastIndex];
        const prevPoint =
          lastIndex >= 1 ? this.strokePoints[lastIndex - 1] : undefined;
        this.$tools.paint.paintLabelmap(
          labelmap,
          axisIndex,
          lastPoint,
          prevPoint
        );
      }
    },
    startStroke(indexPoint: vec3, axisIndex: 0 | 1 | 2) {
      this.strokePoints = [vec3.clone(indexPoint)];
      this._doPaintStroke(axisIndex);
    },
    placeStrokePoint(indexPoint: vec3, axisIndex: 0 | 1 | 2) {
      this.strokePoints.push(indexPoint);
      this._doPaintStroke(axisIndex);
    },
    endStroke(indexPoint: vec3, axisIndex: 0 | 1 | 2) {
      this.strokePoints.push(indexPoint);
      this._doPaintStroke(axisIndex);
    },
  },
});
