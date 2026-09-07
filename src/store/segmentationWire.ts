import type { Ref, ComputedRef } from 'vue';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import vtkLabelMap from '@/src/vtk/LabelMap';
import { allocateMask, relabelMask } from '@/src/store/segmentMask';
import { LABELMAP_MAX_VALUE } from '@/src/store/segmentLabelValue';
import {
  createLabelRemapper,
  createParentImageLoader,
  orderedWireMasks,
  planArtifactRestore,
  prepareRestoreBindings,
  restoredLabelmapImage,
} from '@/src/store/segmentationRestore';
import { readImage, writeSegmentation } from '@/src/io/readWriteImage';
import type { ArtifactRestoreSource } from '@/src/io/import/processors/restoreStateFile';
import type {
  Manifest,
  SegmentationArtifact,
  StateFile,
} from '@/src/io/state-file/schema';
import { makeSegmentGroupArchivePath } from '@/src/io/state-file/segmentGroupArchivePath';
import type { FileEntry } from '@/src/io/types';
import type { Maybe, ProcessingResultSource } from '@/src/types';
import { toLabelmapSegment } from '@/src/types/segment';
import { cleanUndefined } from '@/src/utils';
import { normalize } from '@/src/utils/path';
import { untilLoaded } from '@/src/composables/untilLoaded';
import { toLabelMap } from '@/src/io/labelmapImport';
import { ensureSameSpace } from '@/src/io/resample/resample';
import { useDatasetStore } from '@/src/store/datasets';
import {
  listMasks,
  type ArtifactMetadata,
  type Extent3D,
  type LabelmapSegment,
  type SegmentMask,
  type Segmentation,
} from '@/src/types/segmentation';

import type { useImageCacheStore } from '@/src/store/image-cache';
import type { SegmentRegistry } from '@/src/store/tools/segmentRegistry';
import type { DataSelection } from '@/src/utils/dataSelection';

/**
 * The labelmap codec the state file writes through. Injected because itk-wasm
 * and the vti worker have no node counterpart.
 */
export type SegmentationArtifactIO = {
  write: (
    format: string,
    labelmap: vtkLabelMap,
    segments: LabelmapSegment[]
  ) => Promise<string | Uint8Array>;
  read: (
    file: File
  ) => Promise<{ image: vtkImageData; headerMetadata?: Map<string, string> }>;
};

const defaultArtifactIO: SegmentationArtifactIO = {
  write: writeSegmentation,
  read: readImage,
};

/** What the wire needs from the store that owns the records. */
export type SegmentationWireDeps = {
  segmentations: Record<string, Segmentation>;
  artifactIndex: Record<string, vtkLabelMap>;
  artifactMeta: Record<string, ArtifactMetadata>;
  saveFormat: Ref<string>;
  imageCacheStore: ReturnType<typeof useImageCacheStore>;
  segmentRegistry: SegmentRegistry;
  labelmapSegmentsByArtifact: ComputedRef<Record<string, LabelmapSegment[]>>;
  createMask: (segmentationId: string, segmentId: string) => SegmentMask;
  decodeSegments: (
    imageId: DataSelection | undefined,
    image: vtkLabelMap,
    options?: { component?: number; headerMetadata?: Map<string, string> }
  ) => Promise<Array<Omit<LabelmapSegment, 'color'> & { color: number[] }>>;
  ensureSegmentationForImage: (parentImageId: string) => Segmentation;
  getSegmentationForImage: (parentImageId: string) => Segmentation | undefined;
  maskFor: (
    imageId: Maybe<string>,
    segmentId: Maybe<string>
  ) => SegmentMask | undefined;
  masksForArtifact: (artifactId: string) => SegmentMask[];
  nextLabelValue: (segmentation: Segmentation, preferred?: number) => number;
  registerArtifact: (labelmap: vtkLabelMap, meta: ArtifactMetadata) => string;
  removeArtifact: (artifactId: string) => void;
  splitLabelmapIntoMasks: (
    parentImageId: string,
    labelmap: vtkLabelMap,
    descriptors: LabelmapSegment[],
    options?: {
      source?: ProcessingResultSource;
      artifactName?: string;
      segmentIdFor?: (descriptor: LabelmapSegment) => Maybe<string>;
    }
  ) => SegmentMask[];
};

export type DeserializeOptions = {
  manifest: Manifest;
  stateFiles: FileEntry[];
  dataIDMap: Record<string, string>;
  /** Ids the registry minted for the incoming segments, keyed by wire id. */
  segmentIdMap?: Record<string, string>;
  /**
   * Per-artifact restore source, resolved by the restore setup (see
   * resolveArtifactRestoreSources in restoreStateFile.ts, the single owner of
   * the synthesized-leaf and ownership policy). Mapped through dataIDMap here.
   */
  artifactSources?: Record<string, ArtifactRestoreSource>;
  io?: SegmentationArtifactIO;
};

/**
 * The state-file half of the segmentation store: what a scene writes to an
 * archive and what a restore reads back. Split out so the store itself holds
 * the records, and given the store's own accessors rather than reaching for
 * them, which keeps the invariants in one place.
 */
export function createSegmentationWire(deps: SegmentationWireDeps) {
  const {
    segmentations,
    artifactIndex,
    artifactMeta,
    saveFormat,
    imageCacheStore,
    segmentRegistry,
    labelmapSegmentsByArtifact,
    createMask,
    decodeSegments,
    ensureSegmentationForImage,
    getSegmentationForImage,
    maskFor,
    masksForArtifact,
    nextLabelValue,
    registerArtifact,
    removeArtifact,
    splitLabelmapIntoMasks,
  } = deps;

  /**
   * A mask that covers nothing holds no voxels, and an image codec has nothing
   * to write; the binding's empty extent is what restores it, so one background
   * voxel stands in for the bytes.
   */
  function writableMask(artifactId: string) {
    const mask = artifactIndex[artifactId];
    if (mask.getDimensions().every((size) => size > 0)) return mask;
    const parent = imageCacheStore.getVtkImageData(
      artifactMeta[artifactId].parentImage
    );
    return parent ? allocateMask(parent, [0, 0, 0, 0, 0, 0]) : mask;
  }

  async function serialize(
    state: StateFile,
    io: SegmentationArtifactIO = defaultArtifactIO
  ) {
    const { zip, manifest } = state;
    const format = saveFormat.value;
    const usedArchivePaths = new Set<string>();

    const entries = Object.keys(artifactMeta).map((artifactId) => ({
      artifactId,
      meta: artifactMeta[artifactId],
      path: makeSegmentGroupArchivePath(
        artifactMeta[artifactId].name,
        format,
        usedArchivePaths
      ),
    }));

    manifest.segmentationArtifacts = entries.map(
      ({ artifactId, meta, path }) => ({
        id: artifactId,
        parentImage: meta.parentImage,
        name: meta.name,
        path,
        ...(meta.source ? { source: meta.source } : {}),
      })
    );

    manifest.segmentations = Object.values(segmentations).map(
      (segmentation) => ({
        id: segmentation.id,
        name: segmentation.name,
        parentImage: segmentation.parentImageId,
        fillOpacity: segmentation.fillOpacity,
        outlineOpacity: segmentation.outlineOpacity,
        outlineThickness: segmentation.outlineThickness,
        masks: listMasks(segmentation).map((segment) => {
          const binding = segment.representations.labelmap;
          return {
            id: segment.id,
            segmentId: segment.segmentId,
            representations: binding
              ? {
                  labelmap: {
                    artifactId: binding.artifactId,
                    labelValue: binding.labelValue,
                    extent: [...binding.extent] as Extent3D,
                  },
                }
              : {},
          };
        }),
        order: [...segmentation.order],
      })
    );

    await Promise.all(
      entries.map(async ({ artifactId, path }) => {
        zip.file(
          path,
          await io.write(
            format,
            writableMask(artifactId),
            labelmapSegmentsByArtifact.value[artifactId] ?? []
          )
        );
      })
    );
  }

  async function deserialize({
    manifest,
    stateFiles,
    dataIDMap,
    segmentIdMap = {},
    artifactSources = {},
    io = defaultArtifactIO,
  }: DeserializeOptions) {
    const wireArtifacts = manifest.segmentationArtifacts ?? [];
    const artifactIdMap: Record<string, string> = {};
    const maskIdMap: Record<string, string> = {};
    // Non-silent drops: every artifact left out of the restore is recorded with
    // a concrete reason so the caller can surface it.
    const skipped: Array<{ name: string; reason: string }> = [];

    // A path-less artifact's store id: the restore setup already resolved which
    // STATE id carries its bytes; this only maps that id through dataIDMap.
    const artifactStoreId = (artifact: SegmentationArtifact) => {
      if (artifact.path !== undefined) return undefined;
      const source = artifactSources[artifact.id];
      return source !== undefined ? dataIDMap[source.stateId] : undefined;
    };

    // `path` is authoritative for bytes when present: a re-saved zip carries the
    // archive bytes AND the provenance `dataSourceId`, but `dataIDMap` is keyed
    // by save-time DATASET ids.
    async function loadArtifactImage(
      artifact: SegmentationArtifact,
      storeId: string | undefined
    ) {
      if (artifact.path !== undefined) {
        const file = stateFiles.find(
          (entry) => entry.archivePath === normalize(artifact.path!)
        )?.file;
        return io.read(file!);
      }

      await untilLoaded(storeId!);
      const image = imageCacheStore.getVtkImageData(storeId!);
      if (!image) {
        throw new Error(
          `Could not get image data for dataSourceId ${artifact.dataSourceId}`
        );
      }
      return {
        image,
        headerMetadata: imageCacheStore.imageById[storeId!]?.headerMetadata,
      };
    }

    const { boundArtifactIds, needsDecode, needsSplit } =
      planArtifactRestore(manifest);
    const loadedParentImage = createParentImageLoader(
      dataIDMap,
      untilLoaded,
      (id) => imageCacheStore.getVtkImageData(id) ?? undefined
    );

    // Skip BEFORE awaiting anything an artifact whose parent image is
    // unresolved, or a path-less one whose datasource never materialized;
    // `untilLoaded(undefined)` never times out and would hang restore forever.
    const attachable = wireArtifacts.filter((artifact) => {
      if (dataIDMap[artifact.parentImage] === undefined) {
        skipped.push({
          name: artifact.name,
          reason: 'parent image did not load',
        });
        return false;
      }
      if (artifact.path !== undefined) return true;
      const hasArtifact = artifactStoreId(artifact) !== undefined;
      if (!hasArtifact) {
        skipped.push({
          name: artifact.name,
          reason: 'artifact source unavailable',
        });
      }
      return hasArtifact;
    });

    // Every path-less artifact's temporary imported dataset must be removed
    // exactly ONCE, and only AFTER every artifact that reads it has settled;
    // two artifacts sharing a dataSourceId share one temp dataset id. Collected
    // from EVERY artifact, not just the attachable ones: one skipped at the
    // parent-image check may still have imported its leaf.
    const tempStoreIdsToRemove = new Set(
      wireArtifacts
        .filter((artifact) => artifactSources[artifact.id]?.temporary === true)
        .map(artifactStoreId)
        .filter((storeId): storeId is string => storeId !== undefined)
    );

    let loaded;
    try {
      loaded = await Promise.all(
        attachable.map(async (artifact) => {
          const storeId = artifactStoreId(artifact);
          try {
            const { image, headerMetadata } = await loadArtifactImage(
              artifact,
              storeId
            );
            const labelmap = toLabelMap(
              await restoredLabelmapImage(artifact, image, {
                needsSplit,
                loadedParentImage,
                ensureSameSpace,
              })
            );
            // A group that carried no descriptors is enumerated here, through
            // the same decode live import uses, while its source image is
            // still loaded: the temp artifact dataset is dropped below.
            const decoded = needsDecode(artifact)
              ? ((await decodeSegments(storeId, labelmap, {
                  headerMetadata,
                })) as LabelmapSegment[])
              : undefined;
            return { artifact, labelmap, decoded };
          } catch {
            // A parse/read failure skips just this artifact and never rejects the
            // whole restore; the survivors still attach.
            skipped.push({
              name: artifact.name,
              reason: 'could not read/parse labelmap',
            });
            return undefined;
          }
        })
      );
    } finally {
      const datasetStore = useDatasetStore();
      tempStoreIdsToRemove.forEach((storeId) => datasetStore.remove(storeId));
    }

    loaded.forEach((result) => {
      if (!result) return;
      const { artifact, labelmap } = result;
      artifactIdMap[artifact.id] = registerArtifact(labelmap, {
        parentImage: dataIDMap[artifact.parentImage],
        name: artifact.name,
        ...(artifact.source ? { source: artifact.source } : {}),
      });
    });

    // A migrated group holds every segment in one buffer, so its bindings are
    // placeholders until it is split below; nothing reshapes its mask.
    const artifactsToSplit = new Set(
      loaded.flatMap((result) =>
        result && needsSplit(result.artifact)
          ? [artifactIdMap[result.artifact.id]]
          : []
      )
    );

    // Validate every reference before changing shared artifact geometry. One
    // malformed binding must not reshape or erase storage a later binding uses.
    const prepared = prepareRestoreBindings({
      manifest,
      dataIDMap,
      artifactIdMap,
      artifactsToSplit,
      artifactParentById: Object.fromEntries(
        Object.entries(artifactMeta).map(([id, meta]) => [id, meta.parentImage])
      ),
      artifactImages: artifactIndex,
      getParentImage: (id) => imageCacheStore.getVtkImageData(id) ?? undefined,
    });
    skipped.push(...prepared.skipped);
    const { acceptedBindings } = prepared;

    const { relabels, remap } = createLabelRemapper(
      artifactsToSplit,
      nextLabelValue,
      LABELMAP_MAX_VALUE
    );

    (manifest.segmentations ?? []).forEach((wire) => {
      const parentImageId = dataIDMap[wire.parentImage];
      if (parentImageId === undefined) return;

      // An import into an image that already has masks adds to them: the
      // display this scene is set to is the user's, not the incoming file's.
      const existing = getSegmentationForImage(parentImageId);
      const segmentation =
        existing ?? ensureSegmentationForImage(parentImageId);
      if (!existing) {
        segmentation.name = wire.name;
        segmentation.fillOpacity = wire.fillOpacity;
        segmentation.outlineOpacity = wire.outlineOpacity;
        segmentation.outlineThickness = wire.outlineThickness;
      }

      orderedWireMasks(wire).forEach((wireMask) => {
        // A mask whose segment did not restore has no identity to show, and a
        // second mask for a segment already on this image cannot exist.
        const segmentId = segmentIdMap[wireMask.segmentId];
        if (!segmentId || maskFor(parentImageId, segmentId)) return;

        const segment = createMask(segmentation.id, segmentId);

        const binding = wireMask.representations.labelmap;
        const accepted = acceptedBindings.get(wireMask);
        if (binding && accepted) {
          const labelValue = remap(
            segmentation,
            accepted.artifactId,
            binding.labelValue,
            (reason) =>
              skipped.push({
                name: segmentRegistry.appearanceOf(segmentId).name,
                reason,
              })
          );
          if (labelValue !== undefined) {
            segment.representations.labelmap = {
              artifactId: accepted.artifactId,
              labelValue,
              extent: accepted.extent,
            };
          }
        }
        maskIdMap[wireMask.id] = segment.id;
      });
    });

    relabels.forEach((mapping, artifactId) =>
      relabelMask(artifactIndex[artifactId], mapping)
    );

    // Split after the wire segmentations so a legacy group's segments follow
    // the ones the manifest named, not precede them. A migrated group holds
    // every segment in one buffer: `decoded` names them when the group carried
    // no descriptors, the restored bindings when it did.
    loaded.forEach((result) => {
      if (!result) return;
      const { artifact } = result;
      const artifactId = artifactIdMap[artifact.id];
      if (!artifactsToSplit.has(artifactId)) return;

      // `decoded` names the segments when the group carried no descriptors;
      // otherwise the bindings the manifest just restored do.
      const migrated = masksForArtifact(artifactId);
      // A descriptor built from a mask carries that mask's segment, so the
      // split lands in the segment the manifest named rather than matching by
      // name against a segment another mask already holds.
      const carriedTypeIds = new Map<LabelmapSegment, string>();
      const descriptors = (
        result.decoded ??
        migrated.map((segment) => {
          const descriptor = toLabelmapSegment(
            segmentRegistry.getSegment(segment.segmentId),
            segment.representations.labelmap!.labelValue
          );
          carriedTypeIds.set(descriptor, segment.segmentId);
          return descriptor;
        })
      ).map((descriptor) => {
        const withDisplay = {
          ...descriptor,
          ...cleanUndefined({
            fillOpacity: artifact.pendingFillOpacity,
            outlineOpacity: artifact.pendingOutlineOpacity,
            visible:
              artifact.pendingVisibility === undefined
                ? undefined
                : descriptor.visible && artifact.pendingVisibility,
          }),
        };
        const carried = carriedTypeIds.get(descriptor);
        if (carried) carriedTypeIds.set(withDisplay, carried);
        return withDisplay;
      });

      // The source goes first, so the split segments can take the label values
      // the migrated ones were holding.
      const parentImageId = dataIDMap[artifact.parentImage];
      const segmentation = ensureSegmentationForImage(parentImageId);
      const orderBefore = [...segmentation.order];
      const labelmap = artifactIndex[artifactId];
      const migratedIds = migrated.map((segment) => segment.id);
      const wireIdByStoreId = new Map(
        Object.entries(maskIdMap).map(([wireId, storeId]) => [storeId, wireId])
      );
      const selectedBefore = segmentRegistry.selectedSegmentId.value;
      const migratedTypeIds = new Map(
        migrated.map((segment) => [segment.id, segment.segmentId])
      );
      removeArtifact(artifactId);

      const created = splitLabelmapIntoMasks(
        parentImageId,
        labelmap,
        descriptors,
        {
          source: artifact.source,
          artifactName: artifact.name,
          segmentIdFor: (descriptor) => carriedTypeIds.get(descriptor),
        }
      );

      // Every reference to a segment that went with the source artifact moves
      // onto the split one that replaced it, its place in the order included.
      const replacementOf = new Map<string, string>();
      migratedIds.forEach((maskId, index) => {
        const replacement = created[index];
        if (!replacement) return;
        replacementOf.set(maskId, replacement.id);
        const wireId = wireIdByStoreId.get(maskId);
        if (wireId) maskIdMap[wireId] = replacement.id;
        // The split mints its own types, so a selection on the source type
        // follows onto the segment its replacement landed in.
        if (selectedBefore === migratedTypeIds.get(maskId))
          segmentRegistry.selectSegment(replacement.segmentId);
      });

      const placed = orderBefore.flatMap((maskId) => {
        const replacement = replacementOf.get(maskId);
        if (replacement) return [replacement];
        return segmentation.masks[maskId] ? [maskId] : [];
      });
      segmentation.order = [
        ...placed,
        ...created
          .map((segment) => segment.id)
          .filter((maskId) => !placed.includes(maskId)),
      ];

      // A migrated legacy group carried its active paint value here, because
      // its segments did not exist when activeSegment was applied above. It is
      // a SOURCE value, and the split segment holding it keeps that value only
      // when nothing else on this parent image already had it, so the
      // descriptor it came from is what identifies the segment.
      const { pendingActiveValue } = artifact;
      if (pendingActiveValue === undefined) return;
      const activeIndex = descriptors.findIndex(
        (descriptor) => descriptor.value === pendingActiveValue
      );
      const active = activeIndex === -1 ? undefined : created[activeIndex];
      if (active) segmentRegistry.selectSegment(active.segmentId);
    });

    Object.entries(artifactIdMap).forEach(([wireArtifactId, artifactId]) => {
      if (
        artifactMeta[artifactId] &&
        masksForArtifact(artifactId).length === 0
      ) {
        // A bound artifact that lost every segment was already reported per
        // binding; only one nothing referenced gets a notice here.
        if (!boundArtifactIds.has(wireArtifactId)) {
          skipped.push({
            name: artifactMeta[artifactId].name,
            reason: 'labelmap holds no segments',
          });
        }
        removeArtifact(artifactId);
        delete artifactIdMap[wireArtifactId];
      }
    });

    return { artifactIdMap, maskIdMap, skipped };
  }

  return { serialize, deserialize };
}
