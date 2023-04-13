import { defineStore } from 'pinia';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';

interface State {
  idList: string[]; // list of IDs
  dataIndex: Record<string, vtkPolyData>; // ID -> VTK object
  metadata: Record<string, {}>; // ID -> metadata
}
export const useModelStore = defineStore('models', {
  state: (): State => ({
    idList: [],
    dataIndex: {},
    metadata: {},
  }),
  actions: {
    addVTKPolyData(name: string, polyData: vtkPolyData) {
      const id = this.$id.nextID();
      this.idList.push(id);
      this.dataIndex[id] = polyData;
      this.$proxies.addData(id, polyData);
      return id;
    },
  },
});
