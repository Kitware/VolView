import { del, set } from '@vue/composition-api';
import { defineStore } from 'pinia';
import { vec3, mat3, mat4 } from 'gl-matrix';
import { vtkImageData } from '@kitware/vtk.js/Common/DataModel/ImageData';
import { Bounds } from '@kitware/vtk.js/types';

import { defaultLPSDirections, getLPSDirections } from '../utils/lps';
import { removeFromArray } from '../utils';
import { StateFile, DataSetType, DataSet } from '../io/state-file/schema';
import { serializeData } from '../io/state-file/utils';
import { FILE_READERS } from '../io';
import { useFileStore } from './datasets-files';
import { LPSDirections } from '../types/lps';

export interface ImageMetadata {
  name: string;
  orientation: mat3;
  lpsOrientation: LPSDirections;
  spacing: vec3;
  origin: vec3;
  dimensions: vec3;
  worldBounds: Bounds;
  worldToIndex: mat4;
  indexToWorld: mat4;
}

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
    addVTKImageData(name: string, imageData: vtkImageData) {
      const id = this.$id.nextID();

      this.idList.push(id);
      set(this.dataIndex, id, imageData);

      this.$proxies.addData(id, imageData);

      set(this.metadata, id, { ...defaultImageMetadata(), name });
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

        set(this.metadata, id, metadata);
      }
      this.$proxies.updateData(id, imageData);
      set(this.dataIndex, id, imageData);
    },

    deleteData(id: string) {
      if (id in this.dataIndex) {
        del(this.dataIndex, id);
        del(this.metadata, id);
        removeFromArray(this.idList, id);
      }
    },

    async serialize(stateFile: StateFile) {
      const fileStore = useFileStore();
      // We want to filter out volume images (which are generated and don't have
      // input files in fileStore with matching imageID.)
      const dataIDs = this.idList.filter((id) => id in fileStore.byDataID);

      await serializeData(stateFile, dataIDs, DataSetType.IMAGE);
    },

    async deserialize(dataSet: DataSet, file: File) {
      const reader = FILE_READERS.get(file.type);
      if (reader) {
        const dataObj = await reader(
          new File([file], file.name, { type: file.type })
        );
        if (dataObj.isA('vtkImageData')) {
          const id = this.addVTKImageData(file.name, dataObj as vtkImageData);

          return id;
        }
      }

      throw new Error(`No reader for ${file.name}`);
    },
  },
});
