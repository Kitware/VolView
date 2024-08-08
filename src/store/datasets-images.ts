import { defineStore } from 'pinia';
import { vec3, mat3, mat4 } from 'gl-matrix';
import { vtkImageData } from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { Bounds } from '@kitware/vtk.js/types';

import { useIdStore } from '@/src/store/id';
import { defaultLPSDirections, getLPSDirections } from '../utils/lps';
import { removeFromArray } from '../utils';
import { ImageMetadata } from '../types/image';

export const defaultImageMetadata = () => ({
  name: '(none)',
  orientation: mat3.create(),
  lpsOrientation: defaultLPSDirections(),
  spacing: vec3.fromValues(1, 1, 1),
  origin: vec3.create(),
  dimensions: vec3.fromValues(1, 1, 1),
  worldBounds: [0, 1, 0, 1, 0, 1] as Bounds,
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
    dataIndex: Object.create(null),
    metadata: Object.create(null),
  }),
  actions: {
    addVTKImageData(name: string, imageData: vtkImageData, useId?: string) {
      if (useId && useId in this.dataIndex) {
        throw new Error('ID already exists');
      }

      const id = useId || useIdStore().nextId();

      this.idList.push(id);
      this.dataIndex[id] = imageData;

      this.metadata[id] = { ...defaultImageMetadata(), name };
      this.updateData(id, imageData);
      return id;
    },

    updateData(id: string, imageData: vtkImageData) {
      if (id in this.metadata) {
        const metadata: ImageMetadata = {
          name: this.metadata[id].name,
          dimensions: imageData.getDimensions() as vec3,
          spacing: imageData.getSpacing() as vec3,
          origin: imageData.getOrigin() as vec3,
          orientation: imageData.getDirection(),
          lpsOrientation: getLPSDirections(imageData.getDirection()),
          worldBounds: imageData.getBounds(),
          worldToIndex: imageData.getWorldToIndex(),
          indexToWorld: imageData.getIndexToWorld(),
        };

        this.metadata[id] = metadata;
        this.dataIndex[id] = imageData;
      }
      this.dataIndex[id] = imageData;
    },

    deleteData(id: string) {
      if (id in this.dataIndex) {
        delete this.dataIndex[id];
        delete this.metadata[id];
        removeFromArray(this.idList, id);
      }
    },
  },
});
