import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { defineStore } from 'pinia';
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
  state: () =>
    ({
      coloringConfig: {
        colorBy: {
          arrayName: '',
          location: '',
        },
        transferFunction: DEFAULT_PRESET,
      },
    } as State),
  actions: {
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
  },
});
