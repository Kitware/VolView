import { dicomDatasetToTags } from '@/src/io/readDicomTags';
import type { Reconstruction } from '@/packages/dicom/core';
import { defineStore } from 'pinia';
import { Image } from 'itk-wasm';
import type { Chunk } from '@/packages/dicom/core';
import { useImageCacheStore } from '@/src/store/image-cache';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import DicomCineImage from '@/src/core/cine/DicomCineImage';
import { parseCineDicom } from '@/src/core/cine/parseCineDicom';
import {
  groupChunksBySeries,
  type CollectionUpdate,
} from '@/packages/dicom/core';
import type { ProgressiveImage } from '@/src/core/progressiveImage';
import { isUltrasoundMultiframeSopClass, Tags } from '@/packages/dicom/core';
import { useMessageStore } from '@/src/store/messages';
import { ensureError, removeFromArray } from '../utils';
import {
  inSeriesTransaction,
  releaseUnregistered,
  sessionFor,
} from './dicom-import-session';

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
  // Names the scan a split volume was separated out as ('acquisition 2',
  // 'phase 3, echo 1'). Absent on volumes that were not split.
  splitLabel?: string;
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
  const name =
    cleanupName(info.SeriesDescription || info.SeriesNumber) ||
    info.SeriesInstanceUID;
  return info.splitLabel ? `${name} (${info.splitLabel})` : name;
};

export function isCineChunkGroup(chunks: Chunk[]): boolean {
  if (chunks.length !== 1) return false;
  const meta = chunks[0].metadata;
  if (!meta) return false;
  const lookup = Object.fromEntries(dicomDatasetToTags(meta));
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

// A chunk volume, as this store uses it. An instanceof would refuse an
// injected image, so the capability check names the method it calls.
type ChunkVolume = Pick<
  DicomChunkImage,
  'setChunks' | 'getChunks' | 'getOrientation' | 'getReconstruction'
>;

const canHoldChunks = (
  image: ProgressiveImage
): image is ProgressiveImage & ChunkVolume =>
  typeof (image as Partial<ChunkVolume>).setChunks === 'function';

export type ImportChunksDeps = {
  createChunkImage?: () => DicomChunkImage;
  parseCineDicom?: typeof parseCineDicom;
  /**
   * What one series committed, reported inside its own transaction. Another
   * import of the same series runs before or after that call, never between
   * it and the commit it describes, so a caller that publishes here cannot be
   * overtaken by a batch a slower series delayed.
   */
  onCommitted?: (result: ImportChunksResult) => void;
  /**
   * Removes a volume a replan dissolved from everything that names it, before
   * its replacements are reported. This store and the image cache alone by
   * default; the app hands in the dataset store's removal so layers, view
   * configuration and statistics let go of the image before it is evicted.
   */
  removeDissolved?: (id: string) => void;
};

export type ImportChunksResult = {
  // Collection ID to every chunk whose provenance the collection now covers,
  // not just the ones this batch brought.
  volumes: Record<string, Chunk[]>;
  // Collection IDs a replan dissolved. Their datasets must be removed.
  dissolved: string[];
};

/**
 * A batch whose series did not all commit. Each series commits on its own lane
 * and reports itself through `onCommitted`, so what landed is already published
 * when this is thrown.
 */
export class PartialImportError extends Error {
  // The chunks of every series that failed, so the caller blames those sources
  // and not the whole batch.
  readonly failed: Chunk[];

  constructor(cause: Error, failed: Chunk[]) {
    super(cause.message);
    this.name = 'PartialImportError';
    this.cause = cause;
    this.failed = failed;
  }
}

type DatabaseRecord = {
  patient: PatientInfo;
  study: StudyInfo;
  volume: VolumeInfo;
  // What the planner wants the user told about this collection.
  warnings: string[];
};

/**
 * One collection's replacement, prepared before any store is touched. `add`
 * builds a fresh image off-store, `grow` has already applied its members to
 * the image an earlier import registered, and `none` is a collection already
 * loaded as it is planned.
 */
type Candidate =
  | { kind: 'none' }
  | {
      kind: 'add';
      id: string;
      image: ProgressiveImage;
      record: DatabaseRecord;
    }
  | {
      kind: 'grow';
      id: string;
      image: ProgressiveImage & ChunkVolume;
      // The membership held before this batch grew the image, so a sibling's
      // failure can put it back.
      previous: Chunk[];
      previousOrientation: number[] | null;
      previousReconstruction: Reconstruction | null;
      // Whether the batch changed the membership at all; a relabel or a
      // second drop of the same folder does not.
      changed: boolean;
      record: DatabaseRecord;
    };

// Every image a batch builds, so a failure releases them all. An uncommitted
// candidate owns a volume buffer nothing else can free.
const candidateTracker = () => {
  const built: ProgressiveImage[] = [];
  return {
    track: <T extends ProgressiveImage>(image: T) => {
      built.push(image);
      return image;
    },
    release: () => built.forEach((image) => image.dispose()),
  };
};

/**
 * Puts the images a failed batch already grew back to the membership they held,
 * so an abandoned plan leaves no image holding members no record names. An
 * image the user removed meanwhile is disposed and left alone.
 */
const undoGrowth = (candidates: Candidate[]) => {
  const { imageById } = useImageCacheStore();
  return Promise.all(
    candidates.map((candidate) =>
      candidate.kind === 'grow' && imageById[candidate.id] === candidate.image
        ? candidate.image
            .setChunks(
              candidate.previous,
              candidate.previousOrientation,
              candidate.previousReconstruction ?? undefined
            )
            .catch((err) => {
              console.error('Failed to restore DICOM volume membership', err);
            })
        : null
    )
  );
};

type PrepareDeps = {
  createChunkImage: () => DicomChunkImage;
  parseCine: typeof parseCineDicom;
  track: ReturnType<typeof candidateTracker>['track'];
};

const volumeRecord = ({
  id,
  members,
  collection,
}: CollectionUpdate): DatabaseRecord => {
  const metaPairs = members[0].metadata;
  if (!metaPairs) throw new Error('Metadata not ready');
  const metadata = Object.fromEntries(dicomDatasetToTags(metaPairs));
  return {
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
      NumberOfSlices: members.length,
      VolumeID: id,
      Modality: metadata[Tags.Modality],
      SeriesInstanceUID: metadata[Tags.SeriesInstanceUID],
      SeriesNumber: metadata[Tags.SeriesNumber],
      SeriesDescription: metadata[Tags.SeriesDescription],
      WindowLevel: metadata[Tags.WindowLevel],
      WindowWidth: metadata[Tags.WindowWidth],
      ...(collection.label === null ? {} : { splitLabel: collection.label }),
      kind: 'volume',
    },
    warnings: collection.warnings,
  };
};

const cineRecord = (
  id: string,
  header: ReturnType<typeof parseCineDicom>['header']
): DatabaseRecord => ({
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

const tryParseCine = (parse: typeof parseCineDicom, buffer: ArrayBuffer) => {
  try {
    return parse(buffer);
  } catch (err) {
    console.warn(
      'Failed to parse cine DICOM; falling back to volume import',
      err
    );
    return null;
  }
};

/** Null when the clip is not a cine this app can play, so the volume path takes it. */
async function prepareCine(
  loaded: Record<string, VolumeInfo>,
  id: string,
  chunk: Chunk,
  deps: PrepareDeps
): Promise<Candidate | null> {
  // A state-file reload already built this clip.
  if (loaded[id]?.kind === 'cine') return { kind: 'none' };

  const cachedImage = useImageCacheStore().imageById[id];
  if (cachedImage && !(cachedImage instanceof DicomCineImage)) {
    throw new Error(
      `Volume ${id} is already loaded as a non-cine progressive image; cannot re-import as a cine clip.`
    );
  }

  await chunk.loadData();
  const blob = chunk.dataBlob;
  if (!blob) throw new Error('Cine DICOM chunk has no data');

  const parsed = tryParseCine(deps.parseCine, await blob.arrayBuffer());
  if (!parsed || !DicomCineImage.isSupported(parsed.header)) return null;

  return {
    kind: 'add',
    id,
    image: deps.track(new DicomCineImage(parsed)),
    record: cineRecord(id, parsed.header),
  };
}

async function prepareVolume(
  update: CollectionUpdate,
  deps: PrepareDeps
): Promise<Candidate> {
  const {
    id,
    members,
    collection: { orientation, reconstruction },
  } = update;
  const cachedImage = useImageCacheStore().imageById[id];
  if (cachedImage && !canHoldChunks(cachedImage)) {
    throw new Error(
      `Volume ${id} is already loaded as a non-chunk progressive image; cannot re-import as a chunk volume.`
    );
  }

  const record = volumeRecord(update);
  // Growth is part of preparation, not of the commit: the members have to be
  // in the image before any record promises them, and a membership the image
  // cannot hold has to fail while the batch can still be abandoned.
  if (cachedImage) {
    const previous = cachedImage.getChunks();
    const previousOrientation = cachedImage.getOrientation();
    const previousReconstruction = cachedImage.getReconstruction();
    await cachedImage.setChunks(members, orientation, reconstruction);
    const changed =
      previousOrientation?.join() !== orientation?.join() ||
      previous.length !== members.length ||
      previous.some((chunk, index) => chunk !== members[index]);
    return {
      kind: 'grow',
      id,
      image: cachedImage,
      previous,
      previousOrientation,
      previousReconstruction,
      changed,
      record,
    };
  }

  const image = deps.track(deps.createChunkImage());
  await image.setChunks(members, orientation, reconstruction);
  return { kind: 'add', id, image, record };
}

/** Builds a collection's replacement without touching any store. */
async function prepareCandidate(
  loaded: Record<string, VolumeInfo>,
  update: CollectionUpdate,
  deps: PrepareDeps
): Promise<Candidate> {
  const { id, members } = update;
  if (isCineChunkGroup(members)) {
    const cine = await prepareCine(loaded, id, members[0], deps);
    if (cine) return cine;
  }
  return prepareVolume(update, deps);
}

type CommitTarget = {
  volumeInfo: Record<string, VolumeInfo>;
  _updateDatabase: (
    patient: PatientInfo,
    study: StudyInfo,
    volume: VolumeInfo
  ) => void;
  deleteVolume: (volumeKey: string) => void;
};

/**
 * Applies a prepared batch. Synchronous by contract: no await separates the
 * first store mutation from the last, and stale IDs go last so nothing visible
 * is removed before its replacement exists.
 */
function commitPlan(
  store: CommitTarget,
  candidates: Candidate[],
  dissolved: string[],
  removeDissolved: (id: string) => void
) {
  const imageCacheStore = useImageCacheStore();
  const messageStore = useMessageStore();

  candidates.forEach((candidate) => {
    if (candidate.kind === 'none') return;

    if (candidate.kind === 'grow') {
      // The image already holds the members preparation gave it, so this load
      // covers them.
      candidate.image.startLoad();
    } else {
      imageCacheStore.addProgressiveImage(candidate.image, {
        id: candidate.id,
      });
    }

    const { patient, study, volume, warnings } = candidate.record;
    store._updateDatabase(patient, study, volume);
    candidate.image.setName(getDisplayName(volume));
    // A membership that did not change was already warned about.
    if (candidate.kind === 'add' || candidate.changed)
      warnings.forEach((warning) =>
        messageStore.addWarning(
          'A DICOM series did not load as one sound volume',
          `${getDisplayName(volume)} ${warning}`
        )
      );
  });

  dissolved.forEach((id) => {
    const previous = store.volumeInfo[id];
    removeDissolved(id);
    // Whatever the user attached to the dissolved dataset went with it.
    if (previous)
      messageStore.addWarning(
        'A DICOM volume was regrouped',
        `${getDisplayName(previous)} was regrouped into other volumes of its ` +
          'series. Annotations and view settings made on it were removed.'
      );
  });
}

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
    async importChunks(
      chunks: Chunk[],
      deps: ImportChunksDeps = {}
    ): Promise<ImportChunksResult> {
      const createChunkImage =
        deps.createChunkImage ?? (() => new DicomChunkImage());
      const parseCine = deps.parseCineDicom ?? parseCineDicom;
      const onCommitted = deps.onCommitted ?? (() => {});
      const removeDissolved =
        deps.removeDissolved ??
        ((id: string) => {
          this.deleteVolume(id);
          useImageCacheStore().removeImage(id);
        });
      const { registry, preparing } = sessionFor(this);

      const batches = [...groupChunksBySeries(chunks)];
      const perSeries = batches.map(([seriesKey, batch]) =>
        inSeriesTransaction(this, seriesKey, batch, async () => {
          const { updates, removed, rollback, changedSince } =
            await registry.register(batch);

          const { track, release } = candidateTracker();
          const prepared = await Promise.allSettled(
            updates.map((update) =>
              prepareCandidate(this.volumeInfo, update, {
                createChunkImage,
                parseCine,
                track,
              })
            )
          );

          const candidates = prepared.flatMap((result) =>
            result.status === 'fulfilled' ? [result.value] : []
          );
          const failure = prepared.find(
            (result): result is PromiseRejectedResult =>
              result.status === 'rejected'
          );
          // A volume removed while its batch was preparing must not come back
          // at commit, so the batch is abandoned the way a failed one is.
          const removedMeanwhile = changedSince(seriesKey);
          if (failure || removedMeanwhile) {
            // Every candidate has settled, so nothing is still writing to the
            // images this puts back before the lane releases.
            try {
              await undoGrowth(candidates);
            } finally {
              try {
                release();
              } finally {
                // Failed incoming chunks remain available to their caller;
                // only replayed user deletions release previous ownership.
                this.releaseUnregisteredChunks(rollback([seriesKey]));
              }
            }
            throw failure
              ? failure.reason
              : new Error(
                  'A DICOM volume was removed while its series was importing; import the series again.'
                );
          }

          preparing.delete(seriesKey);
          commitPlan(this, candidates, removed, removeDissolved);

          const committed = {
            volumes: Object.fromEntries(
              updates.map(({ id, provenance }) => [id, provenance])
            ),
            dissolved: removed,
          };
          onCommitted(committed);
          return committed;
        }).then((committed) => {
          this.releaseUnregisteredChunks(batch);
          return committed;
        })
      );

      const settled = await Promise.allSettled(perSeries);
      const results = settled.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : []
      );
      const failure = settled.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected'
      );
      // Every lane that committed has already reported itself, so a sibling's
      // failure names only the chunks whose own lane failed.
      if (failure)
        throw new PartialImportError(
          ensureError(failure.reason),
          settled.flatMap((result, index) =>
            result.status === 'rejected' ? batches[index][1] : []
          )
        );

      return {
        volumes: Object.fromEntries(
          results.flatMap(({ volumes }) => Object.entries(volumes))
        ),
        dissolved: results.flatMap(({ dissolved }) => dissolved),
      };
    },

    releaseUnregisteredChunks(chunks: Chunk[]) {
      releaseUnregistered(sessionFor(this).registry, chunks);
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
        this.sliceData[volumeKey] = {};
        this.studyVolumes[studyKey].push(volumeKey);
      }
      // A re-import grows the membership, so the record is rewritten.
      this.volumeInfo[volumeKey] = volume;
    },

    // You should probably call datasetStore.remove instead as this does not
    // remove files/images/layers associated with the volume
    deleteVolume(volumeKey: string) {
      const { registry, preparing } = sessionFor(this);
      // Tentative members can still belong to another visible collection.
      // Rollback returns the deleted collection's original members once all
      // surviving images have restored their ownership.
      groupChunksBySeries(registry.forget(volumeKey)).forEach(
        (chunks, seriesKey) => {
          const deferred = preparing.get(seriesKey);
          if (deferred) chunks.forEach((chunk) => deferred.add(chunk));
          else this.releaseUnregisteredChunks(chunks);
        }
      );

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
