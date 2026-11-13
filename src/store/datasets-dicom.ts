import { dicomDatasetToTags } from '@/src/io/readDicomTags';
import { defineStore } from 'pinia';
import {
  allocateVolume,
  emptyRegistry,
  forgetCollection,
  getDatasetModality,
  registerInstances,
  seriesKeyOf,
  Tags,
  type Instance,
  type InstanceCollectionUpdate,
  type RegistryState,
  type Volume,
} from '@/packages/dicom/core';
import { useImageCacheStore } from '@/src/store/image-cache';
import DicomVolumeImage from '@/src/core/streaming/dicomVolumeImage';
import type { ProgressiveImage } from '@/src/core/progressiveImage';
import DicomCineImage from '@/src/core/cine/DicomCineImage';
import {
  isCineInstance,
  readCineHeader,
  type CineHeader,
} from '@/src/core/cine/cineInstance';
import { surfaceWarning, useMessageStore } from '@/src/store/messages';
import { viewedSlice } from '@/src/store/dicom-viewed-slice';
import { ensureError, groupBy, removeFromArray } from '../utils';

export const ANONYMOUS_PATIENT = 'Anonymous';
export const ANONYMOUS_PATIENT_ID = 'ANONYMOUS';

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
  // Names the scan a split volume was separated out as ('acquisition 2',
  // 'phase 3, echo 1'). Absent on volumes that were not split.
  splitLabel?: string;
  // For 'cine', NumberOfSlices is the frame count. Optional for back-compat
  // with saved state that predates the field.
  kind?: 'volume' | 'cine';
};

type State = {
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
const cleanupName = (name: string | undefined) => {
  return (name ?? '').trim().replace(/\s+/g, ' ');
};

export const getDisplayName = (info: VolumeInfo) => {
  const name =
    cleanupName(info.SeriesDescription || info.SeriesNumber) ||
    info.SeriesInstanceUID ||
    info.VolumeID;
  return info.splitLabel ? `${name} (${info.splitLabel})` : name;
};

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

export type ImportInstancesDeps = {
  createImage?: (id: string) => DicomVolumeImage;
  /**
   * Removes a volume a replan dissolved from everything that names it, before
   * its replacements are reported. This store and the image cache alone by
   * default; the app hands in the dataset store's removal so layers, view
   * configuration and statistics let go of the image before it is evicted.
   */
  removeDissolved?: (id: string) => void;
};

export type ImportInstancesResult = {
  // Collection ID to every instance whose provenance the collection now
  // covers, not just the ones this batch brought.
  volumes: Record<string, Instance[]>;
  // Collection IDs a replan dissolved. Their datasets must be removed.
  dissolved: string[];
};

/**
 * A batch whose series did not all commit. Each series commits on its own, so
 * `committed` holds what the series that did commit landed.
 */
export class PartialImportError extends Error {
  readonly failures: { error: Error; instances: Instance[] }[];

  readonly committed: ImportInstancesResult;

  constructor(
    failures: { error: Error; instances: Instance[] }[],
    committed: ImportInstancesResult
  ) {
    super(failures[0].error.message);
    this.name = 'PartialImportError';
    this.cause = failures[0].error;
    this.failures = failures;
    this.committed = committed;
  }
}

type DatabaseRecord = {
  name: string;
  patient: PatientInfo;
  study: StudyInfo;
  volume: VolumeInfo;
  // What the planner wants the user told about this collection.
  warnings: string[];
};

/**
 * One collection's next value, computed before any store is touched. `keep`
 * is a collection already shown as it is planned; `fill` gives a DICOM image
 * its new volume or SEG object.
 */
type Candidate = { id: string; record: DatabaseRecord } & (
  | { kind: 'keep' }
  | { kind: 'cine'; image: DicomCineImage }
  | { kind: 'dicom'; fill: (image: DicomVolumeImage) => void }
);

const withDisplayName = (
  record: Omit<DatabaseRecord, 'name'>
): DatabaseRecord => ({
  ...record,
  name: getDisplayName(record.volume),
});

const volumeRecord = ({
  id,
  members,
  collection,
}: InstanceCollectionUpdate): DatabaseRecord => {
  const { dataset } = members[0];
  const metadata = Object.fromEntries(dicomDatasetToTags(dataset));
  const frames = parseInt(metadata[Tags.NumberOfFrames] ?? '1', 10);
  return withDisplayName({
    patient: {
      PatientID: metadata[Tags.PatientID],
      PatientName: metadata[Tags.PatientName],
      PatientBirthDate: metadata[Tags.PatientBirthDate],
      PatientSex: metadata[Tags.PatientSex],
    },
    study: {
      StudyID: metadata[Tags.StudyID],
      StudyInstanceUID: metadata[Tags.StudyInstanceUID],
      StudyDate: metadata[Tags.StudyDate],
      StudyTime: metadata[Tags.StudyTime],
      AccessionNumber: metadata[Tags.AccessionNumber],
      StudyDescription: metadata[Tags.StudyDescription],
    },
    volume: {
      NumberOfSlices:
        members.length === 1 && frames > 1 ? frames : members.length,
      VolumeID: id,
      Modality: getDatasetModality(dataset) ?? '',
      SeriesInstanceUID: metadata[Tags.SeriesInstanceUID],
      SeriesNumber: metadata[Tags.SeriesNumber],
      SeriesDescription: metadata[Tags.SeriesDescription],
      WindowLevel: metadata[Tags.WindowLevel],
      WindowWidth: metadata[Tags.WindowWidth],
      ...(collection.label === null ? {} : { splitLabel: collection.label }),
      kind: 'volume',
    },
    warnings: collection.warnings,
  });
};

const cineRecord = (id: string, header: CineHeader): DatabaseRecord =>
  withDisplayName({
    patient: header.patient,
    study: header.study,
    volume: {
      NumberOfSlices: header.numberOfFrames,
      VolumeID: id,
      Modality: header.series.Modality,
      SeriesInstanceUID: header.series.SeriesInstanceUID,
      SeriesNumber: header.series.SeriesNumber,
      SeriesDescription: header.series.SeriesDescription,
      WindowLevel: '',
      WindowWidth: '',
      kind: 'cine',
    },
    warnings: [],
  });

const cineMember = ({ kind, members }: InstanceCollectionUpdate) =>
  kind === 'image' && members.length === 1 && isCineInstance(members[0])
    ? members[0]
    : null;

function cineCandidate(
  id: string,
  clip: Instance,
  cached: ProgressiveImage | undefined
): Candidate {
  const header = readCineHeader(clip);
  const record = cineRecord(id, header);
  return cached
    ? { kind: 'keep', id, record }
    : { kind: 'cine', id, record, image: new DicomCineImage(clip, header) };
}

function fillFor(update: InstanceCollectionUpdate, previous?: Volume) {
  if (update.kind === 'segmentation')
    return (image: DicomVolumeImage) => image.setSegmentation(update.members);
  const volume = allocateVolume(update, {}, previous);
  return (image: DicomVolumeImage) => {
    image.setVolume(volume);
    volume.warnings.forEach(([title, details]) =>
      surfaceWarning(title, details)
    );
  };
}

/** The next value of one planned collection. Pure apart from reading the cache. */
function planCandidate(update: InstanceCollectionUpdate): Candidate {
  const { id } = update;
  const cached = useImageCacheStore().imageById[id];
  const clip = cineMember(update);
  if (clip) return cineCandidate(id, clip, cached);
  const record = volumeRecord(update);
  // A re-import retries whatever failed to load.
  if (cached && update.change === 'unchanged')
    return { kind: 'keep', id, record };
  if (cached && !(cached instanceof DicomVolumeImage))
    throw new Error(
      `Volume ${id} is already loaded as a non-DICOM progressive image; cannot re-import it as a DICOM volume.`
    );
  return {
    kind: 'dicom',
    id,
    record,
    fill: fillFor(update, cached?.getVolume() ?? undefined),
  };
}

type CommitTarget = {
  _updateDatabase: (
    patient: PatientInfo,
    study: StudyInfo,
    volume: VolumeInfo
  ) => void;
  volumeInfo: Record<string, VolumeInfo>;
};

const warnUnsound = (name: string, warnings: string[]) =>
  warnings.forEach((warning) =>
    useMessageStore().addWarning(
      'A DICOM series did not load as one sound volume',
      `${name} ${warning}`
    )
  );

/** Puts a candidate's image in the cache, reusing the one it replaces. */
function showCandidate(
  candidate: Exclude<Candidate, { kind: 'keep' }>,
  createImage: (id: string) => DicomVolumeImage
) {
  const cache = useImageCacheStore();
  const { id } = candidate;
  if (candidate.kind === 'cine') {
    cache.addProgressiveImage(candidate.image, { id });
    return candidate.image;
  }
  const cached = cache.imageById[id] as DicomVolumeImage | undefined;
  const image = cached ?? createImage(id);
  candidate.fill(image);
  if (cached) image.startLoad();
  else cache.addProgressiveImage(image, { id });
  return image;
}

function commitCandidate(
  store: CommitTarget,
  candidate: Candidate,
  createImage: (id: string) => DicomVolumeImage
) {
  const { patient, study, volume, warnings, name } = candidate.record;
  store._updateDatabase(patient, study, volume);
  if (candidate.kind === 'keep') {
    const image = useImageCacheStore().imageById[candidate.id];
    image?.setName(name);
    image?.startLoad();
    return;
  }
  showCandidate(candidate, createImage).setName(name);
  warnUnsound(name, warnings);
}

function reportDissolved(
  store: CommitTarget,
  dissolved: string[],
  removeDissolved: (id: string) => void
) {
  dissolved.forEach((id) => {
    const previous = store.volumeInfo[id];
    removeDissolved(id);
    // Whatever the user attached to the dissolved dataset went with it.
    if (previous)
      useMessageStore().addWarning(
        'A DICOM volume was regrouped',
        `${getDisplayName(previous)} was regrouped into other volumes of its ` +
          'series. Annotations and view settings made on it were removed.'
      );
  });
}

const reportConflicts = (uids: string[]) => {
  if (!uids.length) return;
  useMessageStore().addWarning(
    'DICOM instances share an identifier',
    'Files with conflicting metadata reuse SOP Instance UID(s): ' +
      uids.join(', ') +
      '. Only the first copy was retained. Check the source files before saving the session.'
  );
};

// Kept outside reactive state: a fresh pinia plans from nothing.
const registries = new WeakMap<object, RegistryState>();

const registryOf = (store: object) => registries.get(store) ?? emptyRegistry;

export const useDICOMStore = defineStore('dicom', {
  state: (): State => ({
    patientInfo: {},
    patientStudies: {},
    studyInfo: {},
    studyVolumes: {},
    volumeInfo: {},
    volumeStudy: {},
    studyPatient: {},
  }),
  actions: {
    /**
     * Plans, allocates and publishes each series of the batch in one
     * synchronous step. A series that fails to plan or allocate changes
     * nothing, because nothing computed for it is assigned.
     */
    importInstances(
      instances: Instance[],
      deps: ImportInstancesDeps = {}
    ): ImportInstancesResult {
      const createImage =
        deps.createImage ??
        ((id: string) =>
          new DicomVolumeImage({ focus: () => viewedSlice(id) }));
      const removeDissolved =
        deps.removeDissolved ??
        ((id: string) => {
          this.deleteVolume(id);
          useImageCacheStore().removeImage(id);
        });
      const failures: PartialImportError['failures'] = [];
      const results = [
        ...groupBy(instances, (instance) => seriesKeyOf(instance.dataset)),
      ].flatMap(([, batch]) => {
        try {
          return [this._commitSeries(batch, { createImage, removeDissolved })];
        } catch (error) {
          failures.push({ error: ensureError(error), instances: batch });
          return [];
        }
      });
      const committed = {
        volumes: Object.fromEntries(
          results.flatMap(({ volumes }) => Object.entries(volumes))
        ),
        dissolved: results.flatMap(({ dissolved }) => dissolved),
      };
      if (failures.length) throw new PartialImportError(failures, committed);
      return committed;
    },

    _commitSeries(
      batch: Instance[],
      context: {
        createImage: (id: string) => DicomVolumeImage;
        removeDissolved: (id: string) => void;
      }
    ): ImportInstancesResult {
      const { state, updates, removed, conflictingInstanceUids } =
        registerInstances(registryOf(this), batch);
      const candidates = updates.map(planCandidate);

      registries.set(this, state);
      candidates.forEach((candidate) =>
        commitCandidate(this, candidate, context.createImage)
      );
      reportDissolved(this, removed, context.removeDissolved);
      reportConflicts(conflictingInstanceUids);
      return {
        volumes: Object.fromEntries(
          updates.map(({ id, provenance }) => [id, provenance])
        ),
        dissolved: removed,
      };
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
        this.volumeStudy[volumeKey] = studyKey;
        this.studyVolumes[studyKey].push(volumeKey);
      }
      // A re-import grows the membership, so the record is rewritten.
      this.volumeInfo[volumeKey] = volume;
    },

    // You should probably call datasetStore.remove instead as this does not
    // remove files/images/layers associated with the volume
    deleteVolume(volumeKey: string) {
      registries.set(this, forgetCollection(registryOf(this), volumeKey));

      if (volumeKey in this.volumeInfo) {
        const studyKey = this.volumeStudy[volumeKey];
        delete this.volumeInfo[volumeKey];
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
