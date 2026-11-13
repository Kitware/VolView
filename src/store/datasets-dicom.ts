import { dicomDatasetToTags } from '@/src/io/readDicomTags';
import { defineStore } from 'pinia';
import type { Instance } from '@/packages/dicom/core/instance/readInstance';
import type { DicomDataset } from '@/packages/dicom/core/metadata/dicomDataset';
import {
  getDatasetModality,
  getDatasetTag,
} from '@/packages/dicom/core/metadata/datasetAccess';
import {
  emptyRegistry,
  forgetCollection,
  registerInstances,
  type InstanceCollectionUpdate,
  type RegistryState,
} from '@/packages/dicom/core/collections/instanceRegistry';
import { seriesKeyOf } from '@/packages/dicom/core/collections/instanceFacts';
import { groupBy } from '@/packages/dicom/core/collections/groupBy';
import {
  allocateVolume,
  type Volume,
} from '@/packages/dicom/core/volume/allocateVolume';
import { readBytes } from '@/packages/dicom/core/source/byteSource';
import {
  isUltrasoundMultiframeSopClass,
  Tags,
} from '@/packages/dicom/core/metadata/dicomTags';
import { useImageCacheStore } from '@/src/store/image-cache';
import DicomVolumeImage from '@/src/core/streaming/dicomVolumeImage';
import DicomCineImage from '@/src/core/cine/DicomCineImage';
import {
  parseCineDicom,
  type CineParseResult,
} from '@/src/core/cine/parseCineDicom';
import { surfaceWarning, useMessageStore } from '@/src/store/messages';
import { viewedSlice } from '@/src/store/dicom-viewed-slice';
import { ensureError, removeFromArray } from '../utils';

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

/** A single ultrasound multi-frame instance, which plays as a cine clip. */
export function isCineInstance(dataset: DicomDataset) {
  const sopClass = getDatasetTag(dataset, Tags.SOPClassUID)?.trim() ?? '';
  const frames = parseInt(
    (getDatasetTag(dataset, Tags.NumberOfFrames) ?? '0').trim(),
    10
  );
  return isUltrasoundMultiframeSopClass(sopClass) && frames > 1;
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

export type ImportInstancesDeps = {
  createImage?: (id: string) => DicomVolumeImage;
  parseCineDicom?: typeof parseCineDicom;
  /**
   * What one series committed, reported synchronously with the commit, so no
   * other import can land between the two.
   */
  onCommitted?: (result: ImportInstancesResult) => void;
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
 * A batch whose series did not all commit. Each series commits on its own and
 * reports itself through `onCommitted`, so what landed is already published
 * when this is thrown.
 */
export class PartialImportError extends Error {
  readonly failures: { error: Error; instances: Instance[] }[];

  constructor(failures: { error: Error; instances: Instance[] }[]) {
    super(failures[0].error.message);
    this.name = 'PartialImportError';
    this.cause = failures[0].error;
    this.failures = failures;
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
 * is a collection already shown as it is planned.
 */
type Candidate =
  | { kind: 'keep'; id: string; record: DatabaseRecord | null }
  | {
      kind: 'cine';
      id: string;
      image: DicomCineImage;
      record: DatabaseRecord;
    }
  | { kind: 'volume'; id: string; volume: Volume; record: DatabaseRecord }
  | {
      kind: 'segmentation';
      id: string;
      instances: readonly Instance[];
      record: DatabaseRecord;
    };

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

const cineRecord = (
  id: string,
  header: CineParseResult['header']
): DatabaseRecord =>
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

const tryParseCine = (parse: typeof parseCineDicom, bytes: Uint8Array) => {
  try {
    const parsed = parse(bytes);
    return DicomCineImage.isSupported(parsed.header) ? parsed : null;
  } catch (err) {
    console.warn(
      'Failed to parse cine DICOM; falling back to volume import',
      err
    );
    return null;
  }
};

/** Cine clips need their bytes to decide, so they are read before planning. */
async function readCines(instances: Instance[], parse: typeof parseCineDicom) {
  const never = new AbortController().signal;
  const clips = instances.filter(({ dataset }) => isCineInstance(dataset));
  const parsed = await Promise.all(
    clips.map(async (instance) => {
      // An unreadable clip falls back to the volume path, which reports it.
      const bytes = await readBytes(instance.source, never).catch(() => null);
      return [instance, bytes && tryParseCine(parse, bytes)] as const;
    })
  );
  return new Map(
    parsed.flatMap(([instance, clip]) => (clip ? [[instance, clip]] : []))
  );
}

const samePlan = (volume: Volume, update: InstanceCollectionUpdate) =>
  volume.members.length === update.members.length &&
  volume.members.every((member, index) => member === update.members[index]) &&
  volume.collection.orientation?.join() ===
    update.collection.orientation?.join() &&
  JSON.stringify(volume.reconstruction) ===
    JSON.stringify(update.collection.reconstruction ?? volume.reconstruction);

type PlanContext = {
  loaded: Record<string, VolumeInfo>;
  cines: Map<Instance, CineParseResult>;
};

function cineCandidate(
  update: InstanceCollectionUpdate,
  { loaded, cines }: PlanContext
): Candidate | null {
  const { id, members } = update;
  const parsed = members.length === 1 ? cines.get(members[0]) : undefined;
  // A state-file reload already built this clip.
  if (loaded[id]?.kind === 'cine') return { kind: 'keep', id, record: null };
  const cached = useImageCacheStore().imageById[id];
  if (!parsed || (cached && !(cached instanceof DicomCineImage))) return null;
  return {
    kind: 'cine',
    id,
    image: new DicomCineImage(parsed),
    record: cineRecord(id, parsed.header),
  };
}

/** The next value of one planned collection. Pure apart from reading stores. */
function planCandidate(
  update: InstanceCollectionUpdate,
  context: PlanContext
): Candidate {
  const cine = cineCandidate(update, context);
  if (cine) return cine;
  const { id } = update;
  const cached = useImageCacheStore().imageById[id];
  if (cached && !(cached instanceof DicomVolumeImage))
    throw new Error(
      `Volume ${id} is already loaded as a non-DICOM progressive image; cannot re-import it as a DICOM volume.`
    );
  const record = volumeRecord(update);
  const previous = cached?.getVolume() ?? undefined;
  if (previous && samePlan(previous, update))
    return { kind: 'keep', id, record };
  const allocation = allocateVolume(update, {}, previous);
  if (allocation.kind === 'segmentation')
    return { kind: 'segmentation', id, instances: update.members, record };
  return { kind: 'volume', id, volume: allocation.volume, record };
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
  if (candidate.kind === 'volume') {
    image.setVolume(candidate.volume);
    candidate.volume.warnings.forEach(([title, details]) =>
      surfaceWarning(title, details)
    );
  } else image.setSegmentation(candidate.instances);
  if (cached) image.startLoad();
  else cache.addProgressiveImage(image, { id });
  return image;
}

function commitCandidate(
  store: CommitTarget,
  candidate: Candidate,
  createImage: (id: string) => DicomVolumeImage
) {
  const { record } = candidate;
  if (!record) return;
  const { patient, study, volume, warnings, name } = record;
  store._updateDatabase(patient, study, volume);
  if (candidate.kind === 'keep') {
    // A re-import retries whatever failed to load.
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
    async importInstances(
      instances: Instance[],
      deps: ImportInstancesDeps = {}
    ): Promise<ImportInstancesResult> {
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
      const cines = await readCines(
        instances,
        deps.parseCineDicom ?? parseCineDicom
      );

      const failures: PartialImportError['failures'] = [];
      const results = [
        ...groupBy(instances, (instance) => seriesKeyOf(instance.dataset)),
      ].flatMap(([, batch]) => {
        try {
          const committed = this._commitSeries(batch, {
            cines,
            createImage,
            removeDissolved,
          });
          deps.onCommitted?.(committed);
          return [committed];
        } catch (error) {
          failures.push({ error: ensureError(error), instances: batch });
          return [];
        }
      });
      if (failures.length) throw new PartialImportError(failures);

      return {
        volumes: Object.fromEntries(
          results.flatMap(({ volumes }) => Object.entries(volumes))
        ),
        dissolved: results.flatMap(({ dissolved }) => dissolved),
      };
    },

    _commitSeries(
      batch: Instance[],
      context: {
        cines: Map<Instance, CineParseResult>;
        createImage: (id: string) => DicomVolumeImage;
        removeDissolved: (id: string) => void;
      }
    ): ImportInstancesResult {
      const { state, updates, removed, conflictingInstanceUids } =
        registerInstances(registryOf(this), batch);
      const plan = { loaded: this.volumeInfo, cines: context.cines };
      const candidates = updates.map((update) => planCandidate(update, plan));

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
