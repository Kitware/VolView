import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { defineStore } from 'pinia';
import { useImageStore } from '@/src/store/datasets-images';
import { join, normalize } from '@/src/utils/path';
import { useIdStore } from '@/src/store/id';
import vtkLabelMap from '../vtk/LabelMap';
import { LABELMAP_PALETTE } from '../config';
import { StateFile, Manifest } from '../io/state-file/schema';
import { vtiReader, vtiWriter } from '../io/vtk/async';
import { FileEntry } from '../io/types';
import { findImageID, getDataID } from './datasets';

const LabelmapArrayType = Uint8Array;
export type LabelmapArrayType = Uint8Array;

interface State {
  idList: string[];
  labelmaps: Record<string, vtkLabelMap>;
  parentImage: Record<string, string>;
}

function createLabelmapFromImage(imageData: vtkImageData) {
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
  labelmap.setColorMap(LABELMAP_PALETTE);

  return labelmap;
}

function toLabelMap(imageData: vtkImageData) {
  const labelmap = vtkLabelMap.newInstance(
    imageData.get(
      'spacing',
      'origin',
      'direction',
      'indexToWorld',
      'worldToIndex',
      'dataDescription',
      'pointData'
    )
  );
  labelmap.setDimensions(imageData.getDimensions());
  labelmap.computeTransforms();
  labelmap.setColorMap(LABELMAP_PALETTE);

  return labelmap;
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

      const id = useIdStore().nextId();
      const labelmap = createLabelmapFromImage(imageData);

      this.idList.push(id);
      this.parentImage[id] = imageID;
      this.labelmaps[id] = labelmap;

      this.$proxies.addData(id, labelmap);

      return id;
    },
    async serialize(state: StateFile) {
      const { labelMaps } = state.manifest;
      const { zip } = state;

      await Promise.all(
        Object.entries(this.labelmaps).map(async ([id, labelMap]) => {
          const labelPath = `labels/${id}.vti`;
          const parent = getDataID(this.parentImage[id]);
          labelMaps.push({
            id,
            parent,
            path: labelPath,
          });

          const serializedData = await vtiWriter(labelMap);
          zip.file(labelPath, serializedData);
        })
      );
    },
    async deserialize(
      manifest: Manifest,
      stateFiles: FileEntry[],
      dataIDMap: Record<string, string>
    ) {
      const { labelMaps } = manifest;

      const labelmapIDMap: Record<string, string> = {};

      labelMaps.forEach(async (labelMap) => {
        const [file] = stateFiles
          .filter(
            (entry) =>
              join(entry.archivePath, entry.file.name) ===
              normalize(labelMap.path)
          )
          .map((entry) => entry.file);

        // map parent id to new id
        // eslint-disable-next-line no-param-reassign
        labelMap.parent = dataIDMap[labelMap.parent];

        const { parent } = labelMap;
        const id = useIdStore().nextId();
        labelmapIDMap[labelMap.id] = id;

        const imageData = await vtiReader(file);
        const labelMapObj = toLabelMap(imageData as vtkImageData);
        this.idList.push(id);
        this.parentImage[id] = findImageID(parent);
        this.labelmaps[id] = labelMapObj;
        this.$proxies.addData(id, labelMapObj);
      });

      return labelmapIDMap;
    },
  },
});
