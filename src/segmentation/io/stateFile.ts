import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import vtkLabelMap from '@/src/vtk/LabelMap';
import { untilLoaded } from '@/src/composables/untilLoaded';
import { useSegmentationEditsStore } from '@/src/segmentation/editing/coordinator';
import {
  prepareRestoreBindings,
  type SkippedRestoreItem,
} from '@/src/segmentation/io/restore';
import { readImage, writeSegmentation } from '@/src/io/readWriteImage';
import {
  planLabelmapImports,
  type LabelmapImport,
  type PlannedMask,
  type LabelmapRestoreSource,
} from '@/src/io/import/labelmapImports';
import type { Manifest, StateFile } from '@/src/io/state-file/schema';
import { makeMaskArchivePath } from '@/src/io/state-file/maskArchivePath';
import type { FileEntry } from '@/src/io/types';
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
} from '@/src/segmentation/io/import';
import { useLabelmapImportStore } from '@/src/segmentation/io/labelmapImport';
import { unsupportedLabelsReason } from '@/src/segmentation/io/labelmap';
import { ensureSameSpace } from '@/src/io/resample/resample';
import { useDatasetStore } from '@/src/store/datasets';
import { useImageCacheStore } from '@/src/store/image-cache';
import {
  maskScalars,
  type LabelmapBinding,
  type LabelmapSegment,
} from '@/src/segmentation/model';
import { isEmptyExtent, type Extent3D } from '@/src/segmentation/geometry';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import {
  useSegmentStore,
  type SegmentResolver,
} from '@/src/segmentation/segments';
import { useSegmentationStore } from '@/src/segmentation/store';

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

type DeserializeOptions = {
  manifest: Manifest;
  stateFiles: FileEntry[];
  dataIDMap: Record<string, string>;
  /** The segment each saved segment id restored to, on its image. */
  resolveSegment?: SegmentResolver;
  /**
   * Per-import restore source, resolved by the restore setup (see
   * planLabelmapSources in labelmapImports.ts, the single owner of
   * the synthesized-leaf and ownership policy). Mapped through dataIDMap here.
   */
  labelmapSources?: Record<string, LabelmapRestoreSource>;
  io?: LabelmapIO;
};

/** Writes every image's segments and their masks into the archive and manifest. */
export async function serializeSegmentation(
  state: StateFile,
  io: LabelmapIO = defaultLabelmapIO
) {
  useSegmentationEditsStore().beforeRead();
  const segmentStore = useSegmentStore();
  segmentStore.serialize(state);
  const registry = segmentStore.segments;
  const segmentationStore = useSegmentationStore();
  const { zip, manifest } = state;
  const format = segmentationStore.saveFormat;
  const usedArchivePaths = new Set<string>();

  // One archive entry per mask, named after its image and segment: a labelmap
  // holds that segment's voxels and no other's.
  const writes: Array<() => Promise<void>> = [];
  const toWireLabelmap = (
    imageId: string,
    segmentId: string,
    binding: LabelmapBinding
  ) => {
    // Taken with the manifest: a queued write can outlive the segment.
    const descriptor = toLabelmapSegment(
      registry.getSegment(segmentId),
      SEGMENT_VALUE
    );
    const labelmap = {
      extent: [...binding.extent] as Extent3D,
      path: makeMaskArchivePath(
        `${segmentationStore.segmentationName(imageId)} - ${descriptor.name}`,
        format,
        usedArchivePaths
      ),
      ...(binding.source ? { source: binding.source } : {}),
    };
    writes.push(async () => {
      // An edit can grow a mask still queued for its write, and growth keeps
      // the image instance, so the bounds the codec is handed are only known
      // here: restated in the same tick as the pixels the codec copies.
      labelmap.extent = [...binding.extent] as Extent3D;
      zip.file(
        labelmap.path,
        await io.write(format, binding.image, [descriptor])
      );
    });
    return labelmap;
  };

  manifest.imageSegments?.forEach(({ imageId, segments }) =>
    segments.forEach((segment) => {
      const binding = registry.maskOf(segment.id);
      if (binding)
        Object.assign(segment, {
          labelmap: toWireLabelmap(imageId, segment.id, binding),
        });
    })
  );

  await mapWithLimit(writes, MASK_IO_CONCURRENCY, (write) => write());
}

/** Restores every image's masks a manifest describes. */
export async function deserializeSegmentation({
  manifest,
  stateFiles,
  dataIDMap,
  resolveSegment = () => undefined,
  labelmapSources = {},
  io = defaultLabelmapIO,
}: DeserializeOptions) {
  const { decodeSegments, splitLabelmapIntoMasks } = useLabelmapImportStore();
  const imageCacheStore = useImageCacheStore();
  const segmentRegistry = useSegmentStore().segments;
  const segmentationStore = useSegmentationStore();
  const { imports, segmentations: wireSegmentations } =
    planLabelmapImports(manifest);
  // Planning strips an artifact-bound mask's binding, so its artifact names it.
  const artifactLabelOf = new Map(
    imports.flatMap((item) =>
      item.masks.map(
        ({ mask, value }) => [mask, `${item.name} label ${value}`] as const
      )
    )
  );
  const maskLabel = (wireMask: PlannedMask) =>
    wireMask.name ||
    wireMask.labelmap?.path ||
    artifactLabelOf.get(wireMask) ||
    wireMask.segmentId;
  // The segment each restored wire mask went to.
  const segmentOfWireMask = new Map<PlannedMask, string>();
  // Segments a wire mask claimed, including those whose voxels an artifact
  // split still has to deliver.
  const claimedSegments = new Set<string>();
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
            distinctLabelValues(labelmap).filter((value) => !claimed.has(value))
          );
          const unclaimed = unclaimedValues.size
            ? (await decode()).filter(({ value }) => unclaimedValues.has(value))
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
  const maskLabelmaps = new Map<PlannedMask, vtkLabelMap>();
  const wireMasks = wireSegmentations.flatMap(({ masks }) => masks);
  await mapWithLimit(wireMasks, MASK_IO_CONCURRENCY, async (wireMask) => {
    const binding = wireMask.labelmap;
    // An empty extent holds no voxels, so its segment has no mask.
    if (binding?.path === undefined || isEmptyExtent(binding.extent)) return;
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
    label: maskLabel,
    getParentImage: (id) => imageCacheStore.getVtkImageData(id) ?? undefined,
  });
  skipped.push(...prepared.skipped);
  const { acceptedBindings } = prepared;

  wireSegmentations.forEach((wire) => {
    const parentImageId = dataIDMap[wire.parentImage];
    if (!imageCacheStore.getVtkImageData(parentImageId)) return;

    wire.masks.forEach((wireMask) => {
      const segmentId = resolveSegment(parentImageId, wireMask.segmentId);
      const skip = (reason: string) =>
        skipped.push({ name: maskLabel(wireMask), reason });
      // A segment deleted while masks loaded has no identity to show.
      if (!segmentId || !segmentRegistry.getSegment(segmentId)) {
        skip('its segment did not restore');
        return;
      }
      if (claimedSegments.has(segmentId) || segmentRegistry.maskOf(segmentId)) {
        skip('the image already has a mask for its segment');
        return;
      }

      const accepted = acceptedBindings.get(wireMask);
      if (accepted) segmentRegistry.setMask(segmentId, accepted);
      else if (!artifactLabelOf.has(wireMask)) return;
      claimedSegments.add(segmentId);
      segmentOfWireMask.set(wireMask, segmentId);
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
          // Only a migrated group's own display outranks a segment already here.
          appearance: Object.values(item.display).some(
            (value) => value !== undefined
          )
            ? 'incoming'
            : 'existing',
        }
      );
    let restored: string[];
    if (decoded) {
      restored = splitDecoded(decoded);
      const activeIndex = decoded.findIndex(
        (descriptor) => descriptor.value === item.activeValue
      );
      segmentRegistry.restoreSelection(parentImageId, restored[activeIndex]);
    } else {
      const targets = item.masks.flatMap(({ mask, value }) => {
        const segmentId = segmentOfWireMask.get(mask);
        const segment = segmentRegistry.getSegment(segmentId);
        if (!segmentId || !segment) return [];
        return [{ segmentId, descriptor: toLabelmapSegment(segment, value) }];
      });
      // Keyed as the minter below hands descriptors back.
      const segmentByDescriptor = new Map<LabelmapSegment, string>(
        targets.map(({ segmentId, descriptor }) => [descriptor, segmentId])
      );
      splitLabelmap(
        labelmap,
        targets.map(({ descriptor }) => descriptor),
        (descriptor, extent) => {
          if (!extent) return undefined;
          const binding = segmentationStore.allocateSegmentMask(
            segmentByDescriptor.get(descriptor)!,
            extent,
            item.source
          );
          return maskScalars(binding.image);
        }
      );
      restored = [
        ...targets.map(({ segmentId }) => segmentId),
        ...(unclaimed.length ? splitDecoded(unclaimed) : []),
      ];
    }
    if (restored.length) restoredImportIds.add(item.id);
    else
      skipped.push({ name: item.name, reason: 'labelmap holds no segments' });
  });

  return { restoredImportIds, skipped };
}
