import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import { defineStore } from 'pinia';
import { ViewProxyType } from '../core/proxies';
import { DEFAULT_PRESET } from '../vtk/ColorMaps';

export interface ColorBy {
  arrayName: string;
  location: string;
}
export interface ColoringConfig {
  colorBy: ColorBy;
  transferFunction: string;
}

interface State {
  coloringConfig: ColoringConfig;
}

export const useView3DStore = defineStore('view3D', {
  state: (): State => ({
    coloringConfig: {
      colorBy: {
        arrayName: '',
        location: '',
      },
      transferFunction: DEFAULT_PRESET,
    },
  }),
  actions: {
    createView<T extends vtkViewProxy>() {
      const id = this.$id.nextID();
      return {
        id,
        proxy: <T>this.$proxies.createView(id, ViewProxyType.Volume),
      };
    },
    removeView(id: string) {
      this.$proxies.removeView(id);
    },
    setColorBy(arrayName: string, location: string) {
      this.coloringConfig.colorBy = {
        arrayName,
        location,
      };
    },
    /**
     * Sets the colorBy to be the default point scalars.
     * @param image
     */
    setDefaultColorByFromImage(image: vtkImageData) {
      const scalars = image.getPointData().getScalars();
      this.setColorBy(scalars.getName(), 'pointData');
    },
    setColorTransferFunction(name: string) {
      this.coloringConfig.transferFunction = name;
    },
    resetToDefaultColoring(image: vtkImageData) {
      this.setDefaultColorByFromImage(image);
      this.setColorTransferFunction(DEFAULT_PRESET);
    },
  },
});
