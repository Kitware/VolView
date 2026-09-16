import type { Ref, ComputedRef } from 'vue';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import vtkLabelMap from '@/src/vtk/LabelMap';
import { untilLoaded } from '@/src/composables/untilLoaded';
import { useSegmentationEditsStore } from '@/src/segmentation/editing/coordinator';
import { allocateMask } from '@/src/segmentation/masks/storage';
import {
  orderedWireMasks,
  prepareRestoreBindings,
  unlistedWireMasks,
  type SkippedRestoreItem,
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
import { COMPOUND_EXTENSIONS, normalize } from '@/src/utils/path';
import { FILE_EXTENSIONS } from '@/src/io/mimeTypes';
import {
  componentCount,
  distinctLabelValues,
  splitLabelmap,
  toBinaryMask,
  toLabelMap,
  type DecodeOptions,
} from '@/src/segmentation/io/import';
import { unsupportedLabelsReason } from '@/src/segmentation/io/labelmap';
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

// Longest first, so 'seg.nrrd' ends a name before 'nrrd' does.
const IMAGE_EXTENSIONS = [...COMPOUND_EXTENSIONS, ...FILE_EXTENSIONS].sort(
  (a, b) => b.length - a.length
);

/** An artifact name is display text, not a path: only a known extension ends it. */
const stripImageExtension = (name: string) => {
  const lower = name.toLowerCase();
  const extension = IMAGE_EXTENSIONS.find((ext) => lower.endsWith(`.${ext}`));
  return extension ? name.slice(0, -(extension.length + 1)) : name;
};

const defaultLabelmapIO: LabelmapIO = {
  write: writeSegmentation,
  read: readImage,
};

/**
 * Each mask is its own codec call and each codec call is its own worker, so a
 * scene with many masks would start one worker per mask and hold every parsed
 * mask at once. Save and restore run this many at a time instead.
 */
export const MASK_IO_CONCURRENCY = 4;

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

type SegmentationWireDeps = {
  segmentations: Record<string, Segmentation>;
  saveFormat: Ref<string>;
  imageCacheStore: ReturnType<typeof useImageCacheStore>;
  segmentRegistry: SegmentRegistry;
  labelmapDescriptorByMask: ComputedRef<Record<string, LabelmapSegment>>;
  createMask: (segmentationId: string, segmentId: string) => SegmentMask;
  allocateMaskBinding: (
    maskId: string,
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
    options?: Pick<DecodeOptions, 'headerMetadata' | 'baseName'>
  ) => Promise<LabelmapSegment[]>;
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
      ownSegments?: boolean;
    }
  ) => SegmentMask[];
};

type DeserializeOptions = {
  manifest: Manifest;
  stateFiles: FileEntry[];
  dataIDMap: Record<string, string>;
  /** Ids the registry minted for the incoming segments, keyed by wire id. */
  segmentIdMap?: Record<string, string>;
  /**
   * Per-import restore source, resolved by the restore setup (see
   * planLabelmapSources in labelmapImports.ts, the single owner of
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
    allocateMaskBinding,
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
    const writes: Array<() => Promise<void>> = [];
    const toWireMask = (parentImageId: string, mask: SegmentMask) => {
      const binding = mask.representations.labelmap;
      if (!binding)
        return { id: mask.id, segmentId: mask.segmentId, representations: {} };
      const labelmap = {
        extent: [...binding.extent] as Extent3D,
        path: makeMaskArchivePath(binding.name, format, usedArchivePaths),
        name: binding.name,
        ...(binding.source ? { source: binding.source } : {}),
      };
      // Taken with the manifest: a queued write can outlive the segment.
      const descriptor = labelmapDescriptorByMask.value[mask.id];
      writes.push(async () => {
        // An edit can grow a mask still queued for its write, and growth keeps
        // the image instance, so the bounds the codec is handed are only known
        // here: restated in the same tick as the pixels the codec copies.
        const image = writableMask(parentImageId, binding);
        labelmap.extent = [...binding.extent] as Extent3D;
        zip.file(labelmap.path, await io.write(format, image, [descriptor]));
      });
      return {
        id: mask.id,
        segmentId: mask.segmentId,
        representations: { labelmap },
      };
    };

    manifest.segmentations = Object.values(segmentations).map(
      (segmentation) => ({
        id: segmentation.id,
        name: segmentation.name,
        parentImage: segmentation.parentImageId,
        fillOpacity: segmentation.fillOpacity,
        outlineOpacity: segmentation.outlineOpacity,
        outlineThickness: segmentation.outlineThickness,
        masks: listMasks(segmentation).map((mask) =>
          toWireMask(segmentation.parentImageId, mask)
        ),
        order: [...segmentation.order],
      })
    );

    await mapWithLimit(writes, MASK_IO_CONCURRENCY, (write) => write());
  }

  async function deserialize({
    manifest,
    stateFiles,
    dataIDMap,
    segmentIdMap = {},
    labelmapSources = {},
    io = defaultLabelmapIO,
  }: DeserializeOptions) {
    const { imports, segmentations: wireSegmentations } =
      planLabelmapImports(manifest);
    // Planning strips an artifact-bound mask's binding, so its artifact names it.
    const artifactLabelOf = new Map(
      imports.flatMap((item) =>
        item.masks.map(
          ({ maskId, value }) =>
            [maskId, `${item.name} label ${value}`] as const
        )
      )
    );
    const maskLabel = (wireMask: WireMask) => {
      const binding = wireMask.representations.labelmap;
      return (
        binding?.name ||
        binding?.path ||
        artifactLabelOf.get(wireMask.id) ||
        wireMask.id
      );
    };
    const maskIdMap = new Map<string, string>();
    // Which items reached the scene, by wire id. Each lands as one mask
    // per segment and so has no single store id of its own.
    const restoredImportIds = new Set<string>();
    // Non-silent drops: every labelmap left out of the restore is recorded
    // with a concrete reason so the caller can surface it.
    const skipped: SkippedRestoreItem[] = [];

    // A path-less item's store id: the restore setup already resolved which
    // STATE id carries its bytes; this only maps that id through dataIDMap.
    const sourceStoreId = (item: LabelmapImport) => {
      if (item.path !== undefined) return undefined;
      const source = labelmapSources[item.id];
      return source !== undefined ? dataIDMap[source.stateId] : undefined;
    };

    // The archive's members, keyed once for the whole restore: every item and
    // every mask names one. First entry wins on a key two members share.
    const archiveMembers = new Map<string, File>();
    stateFiles.forEach((entry) => {
      const key = archivePathKey(entry.archivePath);
      if (!archiveMembers.has(key)) archiveMembers.set(key, entry.file);
    });
    const archiveMember = (path: string) =>
      archiveMembers.get(archivePathKey(path));

    const sourceReads = new Map<string, ReturnType<LabelmapIO['read']>>();
    function readImport(item: LabelmapImport, storeId: string | undefined) {
      const { path } = item;
      const key =
        path !== undefined
          ? `archive:${archivePathKey(path)}`
          : `dataset:${storeId}`;
      let read = sourceReads.get(key);
      if (!read) {
        read = (async () => {
          if (path !== undefined) {
            const file = archiveMember(path);
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

    // Settles by the rule a live import waits by, so both treat an image alike.
    const loadedImage = async (imageId: string) => {
      await untilLoaded(imageId);
      const image = imageCacheStore.getVtkImageData(imageId);
      if (!image) throw new Error('Could not get input image data');
      return image;
    };

    // Skip before awaiting anything an item whose parent image is unresolved,
    // whose archive member is missing, or whose datasource never materialized,
    // so each item can be reported with its specific missing-reference reason.
    const attachable = imports.filter((item) => {
      if (dataIDMap[item.parentImage] === undefined) {
        skipped.push({
          name: item.name,
          reason: 'parent image did not load',
        });
        return false;
      }
      if (item.path !== undefined) {
        if (archiveMember(item.path)) return true;
        skipped.push({ name: item.name, reason: 'archive member is missing' });
        return false;
      }
      const hasImport = sourceStoreId(item) !== undefined;
      if (!hasImport) {
        skipped.push({
          name: item.name,
          reason: 'labelmap source unavailable',
        });
      }
      return hasImport;
    });

    // Removed once all reads settle; parent-skipped items may hold a leaf too.
    const tempStoreIdsToRemove = new Set(
      imports
        .filter((item) => labelmapSources[item.id]?.temporary === true)
        .map(sourceStoreId)
        .filter((storeId): storeId is string => storeId !== undefined)
    );

    let loaded;
    try {
      loaded = await mapWithLimit(
        attachable,
        MASK_IO_CONCURRENCY,
        async (item) => {
          const storeId = sourceStoreId(item);
          try {
            const { image, headerMetadata } = await readImport(item, storeId);
            // Bounded conversion indexes a labelmap as single-component, so a
            // multi-component one would split into shifted, truncated masks.
            if (componentCount(image) > 1) {
              skipped.push({
                name: item.name,
                reason: 'multi-component labelmap artifacts are not supported',
              });
              return undefined;
            }
            const parentId = dataIDMap[item.parentImage];
            const parent = await loadedImage(parentId).catch(() => undefined);
            if (!parent) {
              skipped.push({
                name: item.name,
                reason: imageCacheStore.imageById[parentId]
                  ? 'parent image did not load'
                  : 'parent image is unavailable',
              });
              return undefined;
            }
            const { labelmap, excluded } = toLabelMap(
              await ensureSameSpace(parent, image, true)
            );
            if (excluded)
              skipped.push({
                name: item.name,
                reason: unsupportedLabelsReason(excluded),
              });
            // An import that carried no descriptors is enumerated here, through
            // the same decode live import uses, while its source image is
            // still loaded: the temp item dataset is dropped below.
            const decode = () =>
              decodeSegments(storeId, labelmap, {
                headerMetadata,
                // Named after the labelmap, as a live import of its file is.
                baseName:
                  storeId === undefined
                    ? stripImageExtension(item.name) || undefined
                    : undefined,
              });
            if (item.decode)
              return { item, labelmap, decoded: await decode(), unclaimed: [] };
            // Values no saved mask claims keep a default segment, as a live
            // import of the same labelmap would give them. Decoding draws
            // from the shared color cycle, so it runs only when one exists.
            // Only carried values count, so a header's declared-but-empty
            // value never depends on whether some other value was unclaimed.
            const claimed = new Set(item.masks.map(({ value }) => value));
            const unclaimedValues = new Set(
              distinctLabelValues(labelmap).filter(
                (value) => !claimed.has(value)
              )
            );
            const unclaimed = unclaimedValues.size
              ? (await decode()).filter(({ value }) =>
                  unclaimedValues.has(value)
                )
              : [];
            return { item, labelmap, decoded: undefined, unclaimed };
          } catch {
            // A parse/read failure skips just this item and never rejects the
            // whole restore; the survivors still attach.
            skipped.push({
              name: item.name,
              reason: 'could not read/parse labelmap',
            });
            return undefined;
          }
        }
      );
    } finally {
      const datasetStore = useDatasetStore();
      tempStoreIdsToRemove.forEach((storeId) => datasetStore.remove(storeId));
    }

    // A saved mask names an archive entry of its own, read into a buffer of
    // its own: masks share no storage, whatever a hand-edited manifest says.
    const maskLabelmaps = new Map<WireMask, vtkLabelMap>();
    const wireMasks = wireSegmentations.flatMap(orderedWireMasks);
    await mapWithLimit(wireMasks, MASK_IO_CONCURRENCY, async (wireMask) => {
      const binding = wireMask.representations.labelmap;
      if (binding?.path === undefined) return;
      const file = archiveMember(binding.path);
      if (!file) {
        skipped.push({
          name: maskLabel(wireMask),
          reason: 'archive member is missing',
        });
        return;
      }
      try {
        const mask = toBinaryMask((await io.read(file)).image);
        if (mask) maskLabelmaps.set(wireMask, mask);
        else
          skipped.push({
            name: maskLabel(wireMask),
            reason: 'multi-component masks are not supported',
          });
      } catch {
        // One unreadable mask never rejects the restore; the rest attach.
        skipped.push({
          name: maskLabel(wireMask),
          reason: 'could not read/parse labelmap',
        });
      }
    });

    // Reads, resampling and decoding yield to image deletion. Recheck before
    // creating any masks, after every asynchronous placement step has settled.
    const placed = loaded.flatMap((result) => {
      if (!result) return [];
      if (imageCacheStore.getVtkImageData(dataIDMap[result.item.parentImage]))
        return [result];
      skipped.push({
        name: result.item.name,
        reason: 'parent image is unavailable',
      });
      return [];
    });
    const prepared = prepareRestoreBindings({
      segmentations: wireSegmentations,
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

    wireSegmentations.forEach((wire) => {
      unlistedWireMasks(wire).forEach((wireMask) =>
        skipped.push({
          name: maskLabel(wireMask),
          reason: 'its segmentation does not list it',
        })
      );
      const parentImageId = dataIDMap[wire.parentImage];
      if (!imageCacheStore.getVtkImageData(parentImageId)) return;

      // An import into an image that already has masks adds to them: the
      // display this scene is set to is the user's, not the incoming file's.
      const existing = getSegmentationForImage(parentImageId);
      const segmentation =
        existing ?? ensureSegmentationForImage(parentImageId);
      if (!existing) {
        // An unnamed one keeps the image's name, as a live segmentation has.
        if (wire.name) segmentation.name = wire.name;
        segmentation.fillOpacity = wire.fillOpacity;
        segmentation.outlineOpacity = wire.outlineOpacity;
        segmentation.outlineThickness = wire.outlineThickness;
      }

      orderedWireMasks(wire).forEach((wireMask) => {
        const segmentId = segmentIdMap[wireMask.segmentId];
        const reason = dropReason(parentImageId, segmentId);
        if (reason) {
          skipped.push({ name: maskLabel(wireMask), reason });
          return;
        }

        const mask = createMask(segmentation.id, segmentId);

        const accepted = acceptedBindings.get(wireMask);
        if (accepted) attachMaskBinding(mask.id, accepted);
        maskIdMap.set(wireMask.id, mask.id);
      });
    });

    // All asynchronous reads have settled. Fill the masks already placed in
    // wire order; their identities, selection and tool references stay intact.
    placed.forEach(({ item, labelmap, decoded, unclaimed }) => {
      const parentImageId = dataIDMap[item.parentImage];
      // Segments decoded from the labelmap take a migrated group's display.
      const splitDecoded = (descriptors: LabelmapSegment[]) =>
        splitLabelmapIntoMasks(
          parentImageId,
          labelmap,
          descriptors.map((descriptor) => ({
            ...descriptor,
            ...cleanUndefined({
              fillOpacity: item.display.fillOpacity,
              outlineOpacity: item.display.outlineOpacity,
              visible:
                item.display.visible === undefined
                  ? undefined
                  : descriptor.visible && item.display.visible,
            }),
          })),
          {
            source: item.source,
            name: item.name,
            // Migrated groups never merge, and this one's display would be
            // dropped by a same-named segment another image already minted.
            ownSegments: Object.values(item.display).some(
              (value) => value !== undefined
            ),
          }
        );
      let restored: SegmentMask[];
      if (decoded) {
        restored = splitDecoded(decoded);
        const activeIndex = decoded.findIndex(
          (descriptor) => descriptor.value === item.activeValue
        );
        segmentRegistry.restoreSelection(restored[activeIndex]?.segmentId);
      } else {
        const segmentation = getSegmentationForImage(parentImageId);
        const targets = item.masks.flatMap(({ maskId, value }) => {
          const storeMaskId = maskIdMap.get(maskId);
          const mask = storeMaskId && segmentation?.masks[storeMaskId];
          if (!mask) return [];
          const segment = segmentRegistry.getSegment(mask.segmentId);
          return [{ mask, descriptor: toLabelmapSegment(segment, value) }];
        });
        // Keyed as the minter below hands descriptors back.
        const maskByDescriptor = new Map<LabelmapSegment, SegmentMask>(
          targets.map(({ mask, descriptor }) => [descriptor, mask])
        );
        splitLabelmap(
          labelmap,
          targets.map(({ descriptor }) => descriptor),
          (descriptor, extent) => {
            const mask = maskByDescriptor.get(descriptor)!;
            const binding = allocateMaskBinding(
              mask.id,
              extent,
              item.source,
              item.name
            );
            return maskScalars(binding.image);
          }
        );
        restored = [
          ...targets.map(({ mask }) => mask),
          ...(unclaimed.length ? splitDecoded(unclaimed) : []),
        ];
      }
      if (restored.length) restoredImportIds.add(item.id);
      else
        skipped.push({ name: item.name, reason: 'labelmap holds no segments' });
    });

    return { restoredImportIds, skipped };
  }

  return { serialize, deserialize };
}
