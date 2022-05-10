import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { BrushTypes } from '@/src/core/tools/paint';
import { defineStore } from 'pinia';
import { useLabelmapStore } from '../datasets-labelmaps';

interface State {
  activeLabelmapID: string | null;
  brushType: BrushTypes;
  brushSize: number;
}

export const usePaintToolStore = defineStore('paint', {
  state: (): State => ({
    activeLabelmapID: null,
    brushType: BrushTypes.Circle,
    brushSize: 8,
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
  },
});
