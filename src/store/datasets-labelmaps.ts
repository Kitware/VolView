import { set } from '@vue/composition-api';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { defineStore } from 'pinia';
import { useImageStore } from '@/src/store/datasets-images';
import vtkLabelMap from '../vtk/LabelMap';

const LabelmapArrayType = Uint8Array;
export type LabelmapArrayType = Uint8Array;

interface State {
  idList: string[];
  labelmaps: Record<string, vtkLabelMap>;
  parentImage: Record<string, string>;
}

export const useLabelmapStore = defineStore('labelmap', {
  state: (): State => ({
    idList: [],
    labelmaps: Object.create(null),
    parentImage: Object.create(null),
  }),
  actions: {
    newLabelmapFromImage(imageID: string) {
      const imageStore = useImageStore();
      const imageData = imageStore.dataIndex[imageID];
      if (!imageData) {
        return null;
      }

      const points = new LabelmapArrayType(imageData.getNumberOfPoints());
      const labelmap = vtkLabelMap.newInstance(
        imageData.get('spacing', 'origin', 'direction')
      );
      labelmap.getPointData().setScalars(
        vtkDataArray.newInstance({
          numberOfComponents: 1,
          values: points,
        })
      );
      labelmap.setDimensions(imageData.getDimensions());
      labelmap.computeTransforms();

      for (let i = 0; i < 10000; i++) {
        points[Math.floor(Math.random() * points.length)] = 1;
      }

      const id = this.$id.nextID();

      this.idList.push(id);
      set(this.parentImage, id, imageID);
      set(this.labelmaps, id, labelmap);

      this.$proxies.addData(id, labelmap);

      return id;
    },
  },
});
