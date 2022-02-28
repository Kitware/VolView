import { set } from '@vue/composition-api';
import { defineStore } from 'pinia';
import { vec3, mat3, mat4 } from 'gl-matrix';
import { vtkImageData } from '@kitware/vtk.js/Common/DataModel/ImageData';
import {
  LPSAxesToColumns,
  assignColsToLPS,
} from '@src/composables/useLPSDirections';

import { useIDStore } from './id';

export interface ImageMetadata {
  name: string;
  orientation: mat3;
  lpsColumns: LPSAxesToColumns;
  spacing: vec3;
  origin: vec3;
  dimensions: vec3;
  worldBounds: number[]; // length 6
  worldToIndex: mat4;
  indexToWorld: mat4;
}

export const defaultImageMetadata = () => ({
  name: '(none)',
  orientation: mat3.create(),
  lpsColumns: {
    Coronal: 0,
    Sagittal: 1,
    Axial: 2,
  },
  spacing: vec3.fromValues(1, 1, 1),
  origin: vec3.create(),
  dimensions: vec3.fromValues(1, 1, 1),
  worldBounds: [0, 1, 0, 1, 0, 1],
  worldToIndex: mat4.create(),
  indexToWorld: mat4.create(),
});

interface State {
  idList: string[]; // list of IDs
  dataIndex: Record<string, vtkImageData>; // ID -> VTK object
  metadata: Record<string, ImageMetadata>; // ID -> metadata
}

export const useImageStore = defineStore('images', {
  state: (): State => ({
    idList: [],
    dataIndex: {},
    metadata: {},
  }),
  actions: {
    addVTKImageData(name: string, imageData: vtkImageData) {
      const idStore = useIDStore();
      const id = idStore.getNextID();

      this.idList.push(id);
      set(this.dataIndex, id, imageData);

      const metadata: ImageMetadata = {
        name,
        dimensions: imageData.getDimensions() as vec3,
        spacing: imageData.getSpacing() as vec3,
        origin: imageData.getOrigin() as vec3,
        orientation: imageData.getDirection(),
        lpsColumns: assignColsToLPS(imageData.getDirection()),
        worldBounds: imageData.getBounds(),
        worldToIndex: imageData.getWorldToIndex(),
        indexToWorld: imageData.getIndexToWorld(),
      };

      set(this.metadata, id, metadata);
      return id;
    },
  },
});
