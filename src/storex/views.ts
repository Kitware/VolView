import { defineStore } from 'pinia';
import { useImageStore } from './datasets-images';

export type ViewType = '2D' | '3D';

export type LPSAxis = 'Axial' | 'Sagittal' | 'Coronal';

export type ViewDirection = {
  axis: LPSAxis;
  dir: 'Positive' | 'Negative';
};

export interface View2DConfig {
  objType: 'View2D';
  viewDirection: ViewDirection;
  viewUp: ViewDirection;
}

export interface View3DConfig {
  objType: 'View3D';
  viewDirection: ViewDirection;
  viewUp: ViewDirection;
}

export type ViewConfig = View2DConfig | View3DConfig;

export type Layout =
  | {
      objType: 'Layout';
      direction: 'V' | 'H';
      items: Array<Layout | ViewConfig>;
    }
  | ViewConfig;

interface State {
  layout: Layout;
  currentImageID: string | null;
}

export const useViewStore = defineStore('views', {
  state: (): State => ({
    currentImageID: null,
    layout: {
      objType: 'Layout',
      direction: 'V',
      items: [],
    },
  }),
  actions: {
    setLayout(layout: Layout) {
      this.layout = layout;
    },

    /**
     * Sets the current visible image.
     *
     * If imageID not present, then the current image
     * is set to null.
     *
     * @param imageID The selected image ID
     */
    setCurrentImage(imageID: string | null) {
      const imageStore = useImageStore();
      if (imageID && imageID in imageStore.dataIndex) {
        this.currentImageID = imageID;
      } else {
        this.currentImageID = null;
      }
    },
  },
});
