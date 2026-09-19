import { useSegmentationEditsStore } from '@/src/segmentation/editing/coordinator';
import type { Ref, ComputedRef } from 'vue';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import vtkLabelMap from '@/src/vtk/LabelMap';
import { allocateMask } from '@/src/segmentation/masks/storage';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import {
  createLoadedImageReader,
  orderedWireMasks,
  prepareRestoreBindings,
  type LoadedLabelmap,
  type WireMask,
} from '@/src/segmentation/io/restore';
import { readImage, writeSegmentation } from '@/src/io/readWriteImage';
import {
  planLabelmapImports,
  type LabelmapImport,
  type LabelmapRestoreSource,
} from '@/src/io/import/labelmapImports';
import type { Manifest, StateFile } from '@/src/io/state-file/schema';
import { makeMaskArchivePath } from '@/src/io/state-file/maskArchivePath';
import type { FileEntry } from '@/src/io/types';
import type { Maybe, ProcessingResultSource } from '@/src/types';
import { toLabelmapSegment } from '@/src/segmentation/segment';
import { cleanUndefined } from '@/src/utils';
import { normalize } from '@/src/utils/path';
import { splitLabelmap, toLabelMap } from '@/src/segmentation/io/import';
import { ensureSameSpace } from '@/src/io/resample/resample';
import { useDatasetStore } from '@/src/store/datasets';
import {
  listMasks,
  maskScalars,
  type LabelmapBinding,
  type LabelmapSegment,
  type SegmentMask,
  type Segmentation,
} from '@/src/segmentation/model';
import { type Extent3D } from '@/src/segmentation/geometry';

import type { useImageCacheStore } from '@/src/store/image-cache';
import type { SegmentRegistry } from '@/src/segmentation/segmentRegistry';
import type { DataSelection } from '@/src/utils/dataSelection';

/**
 * The labelmap codec the state file writes through. Injected because itk-wasm
 * and the vti worker have no node counterpart.
 */
export type LabelmapIO = {
  write: (
    format: string,
    labelmap: vtkLabelMap,
    segments: LabelmapSegment[]
  ) => Promise<string | Uint8Array>;
  read: (
    file: File
  ) => Promise<{ image: vtkImageData; headerMetadata?: Map<string, string> }>;
};

// ZIP entries are relative; extraction may prefix a root member with a slash.
const archivePathKey = (path: string) => normalize(path).replace(/^\/+/, '');

const defaultLabelmapIO: LabelmapIO = {
  write: writeSegmentation,
  read: readImage,
};

/**
 * Each mask is its own codec call and each codec call is its own worker, so a
 * scene with many masks would start one worker per mask and hold every parsed
 * mask at once. Save and restore run this many at a time instead.
 */
const MASK_IO_CONCURRENCY = 4;

/** Promise.all with a bound on how many run at once; results stay in order. */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await run(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return results;
}

/** What the wire needs from the store that owns the records. */
export type SegmentationWireDeps = {
  segmentations: Record<string, Segmentation>;
  saveFormat: Ref<string>;
  imageCacheStore: ReturnType<typeof useImageCacheStore>;
  segmentRegistry: SegmentRegistry;
  labelmapDescriptorByMask: ComputedRef<Record<string, LabelmapSegment>>;
  createMask: (segmentationId: string, segmentId: string) => SegmentMask;
  createBindingForImage: (
    parentImageId: string,
    extent: Extent3D,
    source?: ProcessingResultSource,
    name?: string
  ) => LabelmapBinding;
  attachMaskBinding: (
    maskId: string,
    binding: LabelmapBinding
  ) => LabelmapBinding;
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
  splitLabelmapIntoMasks: (
    parentImageId: string,
    labelmap: vtkLabelMap,
    descriptors: LabelmapSegment[],
    options?: {
      source?: ProcessingResultSource;
      name?: string;
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
   * Per-import restore source, resolved by the restore setup (see
   * resolveLabelmapSources in labelmapImports.ts, the single owner of
   * the synthesized-leaf and ownership policy). Mapped through dataIDMap here.
   */
  labelmapSources?: Record<string, LabelmapRestoreSource>;
  io?: LabelmapIO;
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
    saveFormat,
    imageCacheStore,
    segmentRegistry,
    labelmapDescriptorByMask,
    createMask,
    createBindingForImage,
    attachMaskBinding,
    decodeSegments,
    ensureSegmentationForImage,
    getSegmentationForImage,
    maskFor,
    splitLabelmapIntoMasks,
  } = deps;

  /**
   * A mask that covers nothing holds no voxels, and an image codec has nothing
   * to write; the binding's empty extent is what restores it, so one background
   * voxel stands in for the bytes.
   */
  function writableMask(parentImageId: string, binding: LabelmapBinding) {
    if (binding.image.getDimensions().every((size) => size > 0))
      return binding.image;
    const parent = imageCacheStore.getVtkImageData(parentImageId);
    return parent ? allocateMask(parent, [0, 0, 0, 0, 0, 0]) : binding.image;
  }

  async function serialize(
    state: StateFile,
    io: LabelmapIO = defaultLabelmapIO
  ) {
    useSegmentationEditsStore().beforeRead();
    const { zip, manifest } = state;
    const format = saveFormat.value;
    const usedArchivePaths = new Set<string>();

    // One archive entry per bound mask, named on the binding itself: a
    // labelmap holds that segment's voxels and no other's.
    const pathOf = new Map<string, string>();
    const entries = Object.values(segmentations).flatMap((segmentation) =>
      listMasks(segmentation).flatMap((segment) => {
        const binding = segment.representations.labelmap;
        if (!binding) return [];
        const path = makeMaskArchivePath(
          binding.name,
          format,
          usedArchivePaths
        );
        pathOf.set(segment.id, path);
        return [
          {
            maskId: segment.id,
            parentImageId: segmentation.parentImageId,
            binding,
            path,
          },
        ];
      })
    );

    delete manifest.segmentationArtifacts;

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
                    extent: [...binding.extent] as Extent3D,
                    path: pathOf.get(segment.id)!,
                    name: binding.name,
                    ...(binding.source ? { source: binding.source } : {}),
                  },
                }
              : {},
          };
        }),
        order: [...segmentation.order],
      })
    );

    await mapWithLimit(
      entries,
      MASK_IO_CONCURRENCY,
      async ({ maskId, parentImageId, binding, path }) => {
        zip.file(
          path,
          await io.write(format, writableMask(parentImageId, binding), [
            labelmapDescriptorByMask.value[maskId],
          ])
        );
      }
    );
  }

  async function deserialize({
    manifest: incoming,
    stateFiles,
    dataIDMap,
    segmentIdMap = {},
    labelmapSources = {},
    io = defaultLabelmapIO,
  }: DeserializeOptions) {
    const { imports, segmentations: wireSegmentations } =
      planLabelmapImports(incoming);
    const manifest = { segmentations: wireSegmentations };
    const maskIdMap: Record<string, string> = {};
    // Which items reached the scene, by wire id. Each lands as one mask
    // per segment and so has no single store id of its own.
    const restoredImportIds = new Set<string>();
    // Non-silent drops: every labelmap left out of the restore is recorded
    // with a concrete reason so the caller can surface it.
    const skipped: Array<{ name: string; reason: string }> = [];

    // A path-less item's store id: the restore setup already resolved which
    // STATE id carries its bytes; this only maps that id through dataIDMap.
    const sourceStoreId = (item: LabelmapImport) => {
      if ('path' in item.input) return undefined;
      const source = labelmapSources[item.id];
      return source !== undefined ? dataIDMap[source.stateId] : undefined;
    };

    const sourceReads = new Map<string, ReturnType<LabelmapIO['read']>>();
    function readImport(item: LabelmapImport, storeId: string | undefined) {
      const input = item.input;
      const key =
        'path' in input
          ? `archive:${archivePathKey(input.path)}`
          : `dataset:${storeId}`;
      let read = sourceReads.get(key);
      if (!read) {
        read = (async () => {
          if ('path' in input) {
            const file = stateFiles.find(
              (entry) =>
                archivePathKey(entry.archivePath) === archivePathKey(input.path)
            )?.file;
            if (!file) throw new Error('Archive member is missing');
            return io.read(file);
          }
          return {
            image: await loadedImage(storeId!),
            headerMetadata: imageCacheStore.imageById[storeId!]?.headerMetadata,
          };
        })();
        sourceReads.set(key, read);
      }
      return read;
    }

    const loadedImage = createLoadedImageReader(
      (id) => imageCacheStore.imageById[id],
      (id) => imageCacheStore.getVtkImageData(id) ?? undefined
    );

    // Skip BEFORE awaiting anything an item whose parent image is
    // unresolved, or a path-less one whose datasource never materialized;
    // `untilLoaded(undefined)` never times out and would hang restore forever.
    const attachable = imports.filter((item) => {
      if (dataIDMap[item.parentImage] === undefined) {
        skipped.push({
          name: item.name,
          reason: 'parent image did not load',
        });
        return false;
      }
      if ('path' in item.input) return true;
      const hasImport = sourceStoreId(item) !== undefined;
      if (!hasImport) {
        skipped.push({
          name: item.name,
          reason: 'labelmap source unavailable',
        });
      }
      return hasImport;
    });

    // Every path-less item's temporary imported dataset must be removed
    // exactly ONCE, and only AFTER every item that reads it has settled;
    // two items sharing a dataSourceId share one temp dataset id. Collected
    // from EVERY item, not just the attachable ones: one skipped at the
    // parent-image check may still have imported its leaf.
    const tempStoreIdsToRemove = new Set(
      imports
        .filter((item) => labelmapSources[item.id]?.temporary === true)
        .map(sourceStoreId)
        .filter((storeId): storeId is string => storeId !== undefined)
    );

    let loaded;
    try {
      loaded = await Promise.all(
        attachable.map(async (item) => {
          const storeId = sourceStoreId(item);
          try {
            const { image, headerMetadata } = await readImport(item, storeId);
            const labelmap = toLabelMap(
              await ensureSameSpace(
                await loadedImage(dataIDMap[item.parentImage]),
                image,
                true
              )
            );
            // A group that carried no descriptors is enumerated here, through
            // the same decode live import uses, while its source image is
            // still loaded: the temp item dataset is dropped below.
            const decoded = item.decode
              ? ((await decodeSegments(storeId, labelmap, {
                  headerMetadata,
                })) as LabelmapSegment[])
              : undefined;
            return { item, labelmap, decoded };
          } catch {
            // A parse/read failure skips just this item and never rejects the
            // whole restore; the survivors still attach.
            skipped.push({
              name: item.name,
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

    // A saved mask names an archive entry of its own, read into a buffer of
    // its own: masks share no storage, whatever a hand-edited manifest says.
    const maskLabelmaps = new Map<WireMask, LoadedLabelmap>();
    const wireMasks = (manifest.segmentations ?? []).flatMap((wire) =>
      orderedWireMasks(wire)
    );
    await mapWithLimit(wireMasks, MASK_IO_CONCURRENCY, async (wireMask) => {
      const binding = wireMask.representations.labelmap;
      if (binding?.path === undefined) return;
      const name = binding.name ?? '';
      const file = stateFiles.find(
        (entry) =>
          archivePathKey(entry.archivePath) === archivePathKey(binding.path!)
      )?.file;
      if (!file) {
        skipped.push({ name, reason: 'archive member is missing' });
        return;
      }
      try {
        const { image } = await io.read(file);
        maskLabelmaps.set(wireMask, {
          labelmap: toLabelMap(image),
          name,
          ...(binding.source ? { source: binding.source } : {}),
        });
      } catch {
        // One unreadable mask never rejects the restore; the rest attach.
        skipped.push({ name, reason: 'could not read/parse labelmap' });
      }
    });

    // Reads, resampling and decoding yield to image deletion. Recheck before
    // creating any masks, after every asynchronous placement step has settled.
    loaded = loaded.filter((result) => {
      if (!result) return false;
      if (imageCacheStore.getVtkImageData(dataIDMap[result.item.parentImage]))
        return true;
      skipped.push({
        name: result.item.name,
        reason: 'parent image is unavailable',
      });
      return false;
    });
    const prepared = prepareRestoreBindings({
      manifest,
      dataIDMap,
      loaded: maskLabelmaps,
      getParentImage: (id) => imageCacheStore.getVtkImageData(id) ?? undefined,
    });
    skipped.push(...prepared.skipped);
    const { acceptedBindings } = prepared;

    // Why a wire mask cannot become a record, or undefined when it can: a
    // mask whose segment did not restore has no identity to show, and a
    // second mask for a segment already on this image cannot exist.
    const dropReason = (imageId: string, segmentId: Maybe<string>) => {
      if (!segmentId) return 'its segment is not in the file';
      if (!segmentRegistry.getSegment(segmentId))
        return 'its segment did not restore';
      if (maskFor(imageId, segmentId))
        return 'the image already has a mask for its segment';
      return undefined;
    };

    (manifest.segmentations ?? []).forEach((wire) => {
      const parentImageId = dataIDMap[wire.parentImage];
      if (!imageCacheStore.getVtkImageData(parentImageId)) return;

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
        const segmentId = segmentIdMap[wireMask.segmentId];
        const reason = dropReason(parentImageId, segmentId);
        if (reason) {
          skipped.push({
            name: wireMask.representations.labelmap?.name ?? '',
            reason,
          });
          return;
        }

        const segment = createMask(segmentation.id, segmentId);

        const accepted = acceptedBindings.get(wireMask);
        if (accepted) attachMaskBinding(segment.id, accepted);
        maskIdMap[wireMask.id] = segment.id;
      });
    });

    // All asynchronous reads have settled. Fill the masks already placed in
    // wire order; their identities, selection and tool references stay intact.
    loaded.forEach((result) => {
      if (!result) return;
      const { item, labelmap, decoded } = result;
      const parentImageId = dataIDMap[item.parentImage];
      let restored: SegmentMask[];
      if (decoded) {
        const descriptors = decoded.map((descriptor) => ({
          ...descriptor,
          ...cleanUndefined({
            fillOpacity: item.display.fillOpacity,
            outlineOpacity: item.display.outlineOpacity,
            visible:
              item.display.visible === undefined
                ? undefined
                : descriptor.visible && item.display.visible,
          }),
        }));
        restored = splitLabelmapIntoMasks(
          parentImageId,
          labelmap,
          descriptors,
          {
            source: item.source,
            name: item.name,
          }
        );
        const activeIndex = descriptors.findIndex(
          (descriptor) => descriptor.value === item.activeValue
        );
        const active = restored[activeIndex];
        if (active) segmentRegistry.selectSegment(active.segmentId);
      } else {
        const segmentation = getSegmentationForImage(parentImageId);
        const targets = item.masks.flatMap(({ maskId, value }) => {
          const mask = segmentation?.masks[maskIdMap[maskId]];
          if (!mask || !segmentRegistry.getSegment(mask.segmentId)) return [];
          return [
            {
              mask,
              descriptor: toLabelmapSegment(
                segmentRegistry.getSegment(mask.segmentId),
                value
              ),
            },
          ];
        });
        const maskByDescriptor = new Map(
          targets.map(({ mask, descriptor }) => [descriptor, mask])
        );
        splitLabelmap(
          labelmap,
          targets.map(({ descriptor }) => descriptor),
          (descriptor, extent) => {
            const mask = maskByDescriptor.get(descriptor)!;
            const binding = createBindingForImage(
              parentImageId,
              extent,
              item.source,
              item.name
            );
            attachMaskBinding(mask.id, binding);
            return {
              labelValue: SEGMENT_VALUE,
              mask: maskScalars(binding.image),
            };
          }
        );
        restored = targets.map(({ mask }) => mask);
      }
      if (restored.length) restoredImportIds.add(item.id);
      else
        skipped.push({ name: item.name, reason: 'labelmap holds no segments' });
    });

    return { restoredImportIds, maskIdMap, skipped };
  }

  return { serialize, deserialize };
}
