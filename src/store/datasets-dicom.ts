import { defineStore } from 'pinia';
import { Image } from 'itk-wasm';
import * as DICOM from '@/src/io/dicom';
import { Chunk } from '@/src/core/streaming/chunk';
import { useImageCacheStore } from '@/src/store/image-cache';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import DicomCineImage from '@/src/core/cine/DicomCineImage';
import { parseCineDicom } from '@/src/core/cine/parseCineDicom';
import { isUltrasoundMultiframeSopClass, Tags } from '@/src/core/dicomTags';
import { removeFromArray } from '../utils';

export const ANONYMOUS_PATIENT = 'Anonymous';
export const ANONYMOUS_PATIENT_ID = 'ANONYMOUS';

export function imageCacheMultiKey(offset: number, asThumbnail: boolean) {
  return `${offset}!!${asThumbnail}`;
}

export type VolumeKeys = {
  patientKey: string;
  studyKey: string;
  volumeKey: string;
};

export type PatientInfo = {
  PatientID: string;
  PatientName: string;
  PatientBirthDate: string;
  PatientSex: string;
};

export type StudyInfo = {
  StudyID: string;
  StudyInstanceUID: string;
  StudyDate: string;
  StudyTime: string;
  AccessionNumber: string;
  StudyDescription: string;
};

export type VolumeInfo = {
  NumberOfSlices: number;
  VolumeID: string;
  Modality: string;
  SeriesInstanceUID: string;
  SeriesNumber: string;
  SeriesDescription: string;
  WindowLevel: string;
  WindowWidth: string;
  // For 'cine', NumberOfSlices is the frame count. Optional for back-compat
  // with saved state that predates the field.
  kind?: 'volume' | 'cine';
};

type State = {
  // volumeKey -> imageCacheMultiKey -> ITKImage
  sliceData: Record<string, Record<string, Image>>;

  // volume invalidation information
  needsRebuild: Record<string, boolean>;

  // patientKey -> patient info
  patientInfo: Record<string, PatientInfo>;
  // patientKey -> array of studyKeys
  patientStudies: Record<string, string[]>;

  // studyKey -> study info
  studyInfo: Record<string, StudyInfo>;
  // studyKey -> array of volumeKeys
  studyVolumes: Record<string, string[]>;

  // volumeKey -> volume info
  volumeInfo: Record<string, VolumeInfo>;

  // parent pointers
  // volumeKey -> studyKey
  volumeStudy: Record<string, string>;
  // studyKey -> patientKey
  studyPatient: Record<string, string>;
};

/**
 * Trims and collapses multiple spaces into one.
 * @param name
 * @returns string
 */
const cleanupName = (name: string) => {
  return name.trim().replace(/\s+/g, ' ');
};

export const getDisplayName = (info: VolumeInfo) => {
  return (
    cleanupName(info.SeriesDescription || info.SeriesNumber) ||
    info.SeriesInstanceUID
  );
};

export function isCineChunkGroup(chunks: Chunk[]): boolean {
  if (chunks.length !== 1) return false;
  const meta = chunks[0].metadata;
  if (!meta) return false;
  const lookup = Object.fromEntries(meta);
  const sopClass = lookup[Tags.SOPClassUID] ?? '';
  const numberOfFrames = parseInt(
    (lookup[Tags.NumberOfFrames] ?? '0').trim(),
    10
  );
  return isUltrasoundMultiframeSopClass(sopClass) && numberOfFrames > 1;
}

export const getWindowLevels = (info: VolumeInfo) => {
  const { WindowWidth, WindowLevel } = info;
  if (
    WindowWidth == null ||
    WindowLevel == null ||
    WindowWidth === '' ||
    WindowLevel === ''
  )
    return []; // missing tag
  const widths = WindowWidth.split('\\').map(parseFloat);
  const levels = WindowLevel.split('\\').map(parseFloat);
  if (
    widths.some((w) => Number.isNaN(w)) ||
    levels.some((l) => Number.isNaN(l))
  ) {
    console.error('Invalid WindowWidth or WindowLevel DICOM tags');
    return [];
  }
  if (widths.length !== levels.length) {
    console.error(
      'Different numbers of WindowWidth and WindowLevel DICOM tags'
    );
    return [];
  }
  return widths.map((width, i) => ({ width, level: levels[i] }));
};

export const useDICOMStore = defineStore('dicom', {
  state: (): State => ({
    sliceData: {},
    patientInfo: {},
    patientStudies: {},
    studyInfo: {},
    studyVolumes: {},
    volumeInfo: {},
    volumeStudy: {},
    studyPatient: {},
    needsRebuild: {},
  }),
  actions: {
    async importChunks(chunks: Chunk[]) {
      const imageCacheStore = useImageCacheStore();

      // split into groups
      const chunksByVolume = await DICOM.splitAndSort(
        chunks,
        (chunk) => chunk.metaBlob!
      );

      await Promise.all(
        Object.entries(chunksByVolume).map(async ([id, sortedChunks]) => {
          if (isCineChunkGroup(sortedChunks)) {
            const importedAsCine = await this._importCineChunk(
              id,
              sortedChunks[0]
            );
            if (importedAsCine) return;
          }

          if (this.volumeInfo[id]?.kind === 'cine') {
            throw new Error(
              `Volume ${id} is already loaded as a cine clip; cannot re-import as a chunk volume.`
            );
          }
          const cachedImage = imageCacheStore.imageById[id];
          if (cachedImage && !(cachedImage instanceof DicomChunkImage)) {
            throw new Error(
              `Volume ${id} is already loaded as a non-chunk progressive image; cannot re-import as a chunk volume.`
            );
          }
          const image = cachedImage ?? new DicomChunkImage();

          await image.addChunks(sortedChunks);
          imageCacheStore.addProgressiveImage(image, { id });

          // update database
          const metaPairs = image.getDicomMetadata();
          if (!metaPairs) throw new Error('Metdata not ready');
          const metadata = Object.fromEntries(metaPairs);

          const patientInfo: PatientInfo = {
            PatientID: metadata[Tags.PatientID],
            PatientName: metadata[Tags.PatientName],
            PatientBirthDate: metadata[Tags.PatientBirthDate],
            PatientSex: metadata[Tags.PatientSex],
          };

          const studyInfo: StudyInfo = {
            StudyID: metadata[Tags.StudyID],
            StudyInstanceUID: metadata[Tags.StudyInstanceUID],
            StudyDate: metadata[Tags.StudyDate],
            StudyTime: metadata[Tags.StudyTime],
            AccessionNumber: metadata[Tags.AccessionNumber],
            StudyDescription: metadata[Tags.StudyDescription],
          };

          const volumeInfo: VolumeInfo = {
            NumberOfSlices: image.getChunks().length,
            VolumeID: id,
            Modality: metadata[Tags.Modality],
            SeriesInstanceUID: metadata[Tags.SeriesInstanceUID],
            SeriesNumber: metadata[Tags.SeriesNumber],
            SeriesDescription: metadata[Tags.SeriesDescription],
            WindowLevel: metadata[Tags.WindowLevel],
            WindowWidth: metadata[Tags.WindowWidth],
            kind: 'volume',
          };

          this._updateDatabase(patientInfo, studyInfo, volumeInfo);

          // save the image name
          image.setName(getDisplayName(volumeInfo));
        })
      );

      return chunksByVolume;
    },

    async _importCineChunk(id: string, chunk: Chunk): Promise<boolean> {
      const imageCacheStore = useImageCacheStore();

      // If we already created this cine image (state-file reload), bail.
      if (this.volumeInfo[id]?.kind === 'cine') {
        return true;
      }

      const cachedImage = imageCacheStore.imageById[id];
      if (cachedImage && !(cachedImage instanceof DicomCineImage)) {
        throw new Error(
          `Volume ${id} is already loaded as a non-cine progressive image; cannot re-import as a cine clip.`
        );
      }

      await chunk.loadData();
      const blob = chunk.dataBlob;
      if (!blob) throw new Error('Cine DICOM chunk has no data');
      const buffer = await blob.arrayBuffer();
      let parsed: ReturnType<typeof parseCineDicom>;
      try {
        parsed = parseCineDicom(buffer);
      } catch (err) {
        console.warn(
          'Failed to parse cine DICOM; falling back to volume import',
          err
        );
        return false;
      }

      if (!DicomCineImage.isSupported(parsed.header)) {
        return false;
      }

      const image = new DicomCineImage(parsed);
      imageCacheStore.addProgressiveImage(image, { id });

      const { patient, study, series } = parsed.header;
      const volumeInfo: VolumeInfo = {
        NumberOfSlices: parsed.header.numberOfFrames,
        VolumeID: id,
        Modality: series.Modality,
        SeriesInstanceUID: series.SeriesInstanceUID,
        SeriesNumber: series.SeriesNumber,
        SeriesDescription: series.SeriesDescription,
        WindowLevel: '',
        WindowWidth: '',
        kind: 'cine',
      };

      this._updateDatabase(patient, study, volumeInfo);

      image.setName(getDisplayName(volumeInfo));
      return true;
    },

    _updateDatabase(
      patient: PatientInfo,
      study: StudyInfo,
      volume: VolumeInfo
    ) {
      const patientKey = patient.PatientID;
      const studyKey = study.StudyInstanceUID;
      const volumeKey = volume.VolumeID;

      if (!(patientKey in this.patientInfo)) {
        this.patientInfo[patientKey] = patient;
        this.patientStudies[patientKey] = [];
      }

      if (!(studyKey in this.studyInfo)) {
        this.studyInfo[studyKey] = study;
        this.studyVolumes[studyKey] = [];
        this.studyPatient[studyKey] = patientKey;
        this.patientStudies[patientKey].push(studyKey);
      }

      if (!(volumeKey in this.volumeInfo)) {
        this.volumeInfo[volumeKey] = volume;
        this.volumeStudy[volumeKey] = studyKey;
        this.sliceData[volumeKey] = {};
        this.studyVolumes[studyKey].push(volumeKey);
      }
    },

    // You should probably call datasetStore.remove instead as this does not
    // remove files/images/layers associated with the volume
    deleteVolume(volumeKey: string) {
      if (volumeKey in this.volumeInfo) {
        const studyKey = this.volumeStudy[volumeKey];
        delete this.volumeInfo[volumeKey];
        delete this.sliceData[volumeKey];
        delete this.volumeStudy[volumeKey];

        removeFromArray(this.studyVolumes[studyKey], volumeKey);
        if (this.studyVolumes[studyKey].length === 0) {
          this._deleteStudy(studyKey);
        }
      }
    },

    _deleteStudy(studyKey: string) {
      if (studyKey in this.studyInfo) {
        const patientKey = this.studyPatient[studyKey];
        delete this.studyInfo[studyKey];
        delete this.studyPatient[studyKey];

        [...this.studyVolumes[studyKey]].forEach((volumeKey) =>
          this.deleteVolume(volumeKey)
        );
        delete this.studyVolumes[studyKey];

        removeFromArray(this.patientStudies[patientKey], studyKey);
        if (this.patientStudies[patientKey].length === 0) {
          this._deletePatient(patientKey);
        }
      }
    },

    _deletePatient(patientKey: string) {
      if (patientKey in this.patientInfo) {
        delete this.patientInfo[patientKey];

        [...this.patientStudies[patientKey]].forEach((studyKey) =>
          this._deleteStudy(studyKey)
        );
        delete this.patientStudies[patientKey];
      }
    },
  },
});
