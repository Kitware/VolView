import { defineStore } from 'pinia';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import { useIdStore } from '@/src/store/id';

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
      const id = useIdStore().nextId();
      this.idList.push(id);
      this.dataIndex[id] = polyData;
      return id;
    },
  },
});
