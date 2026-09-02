import { defineStore } from 'pinia';
import {
  computed,
  markRaw,
  reactive,
  ref,
  shallowRef,
  toRaw,
  watch,
} from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { RGBAColor, TypedArray, Vector3 } from '@kitware/vtk.js/types';

import { CATEGORICAL_COLORS, DEFAULT_SEGMENT_MASKS } from '@/src/config';
import { NO_NAME } from '@/src/constants';
import { createArtifactNamer } from '@/src/store/artifactNaming';
import { onImageDeleted } from '@/src/composables/onImageDeleted';
import { declareManifestRefs } from '@/src/core/manifestRefs';
import { untilLoaded } from '@/src/composables/untilLoaded';
import {
  decodeLabelmapSegments,
  importLabelmapImage,
  splitLabelmap,
  toLabelMap,
} from '@/src/io/labelmapImport';
import { readImage, writeSegmentation } from '@/src/io/readWriteImage';
import type { ArtifactRestoreSource } from '@/src/io/import/processors/restoreStateFile';
import type {
  Manifest,
  SegmentationArtifact,
  StateFile,
} from '@/src/io/state-file/schema';
import { makeSegmentGroupArchivePath } from '@/src/io/state-file/segmentGroupArchivePath';
import type { FileEntry } from '@/src/io/types';
import { useDatasetStore } from '@/src/store/datasets';
import { useIdStore } from '@/src/store/id';
import { useImageCacheStore } from '@/src/store/image-cache';
import type { Maybe, ProcessingResultSource } from '@/src/types';
import {
  type DataSelection,
  getSelectionStem,
} from '@/src/utils/dataSelection';
import {
  emptyExtent,
  extentContains,
  extentContainsIndex,
  extentSize,
  extentUnion,
  fullExtent,
  isEmptyExtent,
  LABELMAP_BACKGROUND_VALUE,
  listSegments,
  makeDefaultSegmentName,
  maskOffset,
  maskScalars,
  toLabelmapSegment,
  type ActiveSegmentIntent,
  type Extent3D,
  type LabelmapBinding,
  type LabelmapSegment,
  type Segment,
  type Segmentation,
  type SegmentationDisplayPatch,
  type SegmentIdentity,
  type SegmentVoxelAccessor,
  type VoxelStorage,
} from '@/src/types/segmentation';
import { isRecord, removeFromArray } from '@/src/utils';
import { normalize } from '@/src/utils/path';
import vtkLabelMap from '@/src/vtk/LabelMap';

export type ArtifactMetadata = {
  parentImage: string;
  name: string;
  source?: ProcessingResultSource;
};

export type SegmentInit = {
  name?: string;
  color?: RGBAColor;
};

export type SegmentPatch = Partial<Omit<Segment, 'id' | 'representations'>>;

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

/** Masks are Uint8Array, so a label value has to fit in one byte. */
export const LABELMAP_MAX_VALUE = 255;

export type { ImportedSegment } from '@/src/io/labelmapImport';

const setMaskScalars = (mask: vtkLabelMap, values: Uint8Array) =>
  mask
    .getPointData()
    .setScalars(vtkDataArray.newInstance({ numberOfComponents: 1, values }));

/**
 * A mask sits on its parent's grid: the parent's spacing and direction, and an
 * origin at the world position of the parent voxel its extent starts at, so a
 * world point resolves to the same voxel in both. An extent that covers
 * nothing is a real state, and its storage holds no voxels at all.
 */
function placeMask(mask: vtkLabelMap, parent: vtkImageData, extent: Extent3D) {
  const dimensions = isEmptyExtent(extent) ? [0, 0, 0] : extentSize(extent);
  const origin = isEmptyExtent(extent)
    ? Array.from(parent.getOrigin())
    : Array.from(
        parent.indexToWorld([extent[0], extent[2], extent[4]] as Vector3)
      );
  mask.setOrigin(origin as Vector3);
  mask.setDimensions(dimensions as Vector3);
  mask.computeTransforms();
  return dimensions;
}

function allocateMask(parent: vtkImageData, extent: Extent3D) {
  const mask = vtkLabelMap.newInstance(
    parent.get('spacing', 'origin', 'direction')
  );
  const dimensions = placeMask(mask, parent, extent);
  setMaskScalars(
    mask,
    new Uint8Array(dimensions[0] * dimensions[1] * dimensions[2])
  );
  return mask;
}

/**
 * Grows a mask in place, keeping the vtk image the renderer's actor is bound
 * to and replacing everything else: the scalars a caller captured before this
 * are no longer the segment's storage.
 */
function regrowMask(
  mask: vtkLabelMap,
  parent: vtkImageData,
  from: Extent3D,
  to: Extent3D
) {
  const previous = maskScalars(mask);
  const previousSize = extentSize(from);
  const dimensions = placeMask(mask, parent, to);
  const values = new Uint8Array(dimensions[0] * dimensions[1] * dimensions[2]);

  if (!isEmptyExtent(from)) {
    for (let k = 0; k < previousSize[2]; k += 1) {
      for (let j = 0; j < previousSize[1]; j += 1) {
        const source = (j + k * previousSize[1]) * previousSize[0];
        const target =
          from[0] -
          to[0] +
          (j + from[2] - to[2]) * dimensions[0] +
          (k + from[4] - to[4]) * dimensions[0] * dimensions[1];
        values.set(previous.subarray(source, source + previousSize[0]), target);
      }
    }
  }

  setMaskScalars(mask, values);
  mask.modified();
}

const pickUniqueSegmentName = (taken: Iterable<string>) => {
  const existing = new Set(taken);
  let index = 1;
  while (existing.has(makeDefaultSegmentName(index))) index += 1;
  return makeDefaultSegmentName(index);
};

const sameIdentity = (a: SegmentIdentity, b: SegmentIdentity) =>
  a.name === b.name && a.color.every((channel, i) => channel === b.color[i]);

// The manifest references this store's remove cascade keeps clean (see the
// onImageDeleted registration below), declared for the dev-only save backstop.
declareManifestRefs('segmentations', (manifest) => {
  const segmentations = Array.isArray(manifest.segmentations)
    ? manifest.segmentations
    : [];
  const artifacts = Array.isArray(manifest.segmentationArtifacts)
    ? manifest.segmentationArtifacts
    : [];

  return [
    ...segmentations.flatMap((raw, index) => {
      if (!isRecord(raw)) return [];
      const where = `segmentations[${index}]`;
      const segments = Array.isArray(raw.segments) ? raw.segments : [];
      return [
        ...(typeof raw.parentImage === 'string'
          ? [
              {
                kind: 'dataset' as const,
                id: raw.parentImage,
                where: `${where}.parentImage`,
              },
            ]
          : []),
        ...segments.flatMap((segment, segmentIndex) => {
          const binding = isRecord(segment)
            ? (segment.representations as Record<string, unknown> | undefined)
                ?.labelmap
            : undefined;
          return isRecord(binding) && typeof binding.artifactId === 'string'
            ? [
                {
                  kind: 'segmentationArtifact' as const,
                  id: binding.artifactId,
                  where: `${where}.segments[${segmentIndex}].representations.labelmap.artifactId`,
                },
              ]
            : [];
        }),
      ];
    }),
    ...artifacts.flatMap((raw, index) =>
      isRecord(raw) && typeof raw.parentImage === 'string'
        ? [
            {
              kind: 'dataset' as const,
              id: raw.parentImage,
              where: `segmentationArtifacts[${index}].parentImage`,
            },
          ]
        : []
    ),
  ];
});

export const useSegmentationStore = defineStore('segmentation', () => {
  const imageCacheStore = useImageCacheStore();

  const segmentations = reactive<Record<string, Segmentation>>({});
  const byParentImage = reactive<Record<string, string>>({});
  // Internal storage layer: UI and tools reach it through this store's API only.
  const artifactIndex = reactive<Record<string, vtkLabelMap>>({});
  const artifactMeta = reactive<Record<string, ArtifactMetadata>>({});
  const artifactNamer = createArtifactNamer(
    () => new Set(Object.values(artifactMeta).map((meta) => meta.name))
  );

  function getSegmentation(segmentationId: string) {
    const segmentation = segmentations[segmentationId];
    if (!segmentation) throw new Error('No such segmentation');
    return segmentation;
  }

  // Segment ids are globally unique and one segmentation per image is
  // enforced, so a segment addresses itself; the segmentation is looked up.
  const segmentationOf = (segmentId: string) =>
    Object.values(segmentations).find(
      (segmentation) => segmentId in segmentation.segments
    );

  const findSegment = (segmentId: string) =>
    segmentationOf(segmentId)?.segments[segmentId];

  function getSegmentationOf(segmentId: string) {
    const segmentation = segmentationOf(segmentId);
    if (!segmentation) throw new Error('No such segment');
    return segmentation;
  }

  function getSegment(segmentId: string) {
    const segment = findSegment(segmentId);
    if (!segment) throw new Error('No such segment');
    return segment;
  }

  function getSegmentationForImage(parentImageId: string) {
    const id = byParentImage[parentImageId];
    return id ? segmentations[id] : undefined;
  }

  function ensureSegmentationForImage(parentImageId: string) {
    const existing = getSegmentationForImage(parentImageId);
    if (existing) return existing;

    const id = useIdStore().nextId();
    segmentations[id] = {
      id,
      name: imageCacheStore.getImageMetadata(parentImageId)?.name ?? NO_NAME,
      parentImageId,
      segments: {},
      order: [],
      fillOpacity: 1,
      outlineOpacity: 1,
      outlineThickness: 2,
    };
    byParentImage[parentImageId] = id;
    return segmentations[id];
  }

  // Deliberately separate from the decode path's cursor: decoded catalogs must
  // be reproducible regardless of how many segments this session has created.
  let nextColorIndex = 0;
  function getNextColor(): RGBAColor {
    const color = CATEGORICAL_COLORS[nextColorIndex];
    nextColorIndex = (nextColorIndex + 1) % CATEGORICAL_COLORS.length;
    return [...color, 255] as RGBAColor;
  }

  function createSegment(segmentationId: string, init?: SegmentInit) {
    const segmentation = getSegmentation(segmentationId);
    const id = useIdStore().nextId();
    segmentation.segments[id] = {
      id,
      name:
        init?.name ??
        pickUniqueSegmentName(
          listSegments(segmentation).map((segment) => segment.name)
        ),
      color: init?.color ? ([...init.color] as RGBAColor) : getNextColor(),
      visible: true,
      locked: false,
      fillOpacity: 1,
      outlineOpacity: 1,
      representations: {},
    };
    segmentation.order.push(id);
    return segmentation.segments[id];
  }

  function getSegmentationForArtifact(artifactId: string) {
    const parentImage = artifactMeta[artifactId]?.parentImage;
    return parentImage ? getSegmentationForImage(parentImage) : undefined;
  }

  /** The ordered segments whose labelmap binding points at one artifact. */
  function segmentsForArtifact(artifactId: string) {
    const segmentation = getSegmentationForArtifact(artifactId);
    if (!segmentation) return [];
    return listSegments(segmentation).filter(
      (segment) => segment.representations.labelmap?.artifactId === artifactId
    );
  }

  /** The artifact an operation's labelmap belongs to. */

  function registerArtifact(labelmap: vtkLabelMap, meta: ArtifactMetadata) {
    const id = useIdStore().nextId();
    artifactIndex[id] = markRaw(labelmap);
    artifactMeta[id] = { ...meta };
    return id;
  }

  /**
   * Allocates a mask on the parent's grid that covers nothing yet. `name` is
   * the name a manifest carried: it reaches the saved zip's entry path and the
   * artifact list, so a restore that generated one instead would rename the
   * file on every round trip. Duplicates are fine, serialize resolves the
   * archive path against the ones it has already used.
   */
  function createArtifactForImage(
    parentImageId: string,
    extent: Extent3D = emptyExtent(),
    source?: ProcessingResultSource,
    name?: string
  ) {
    const imageData = imageCacheStore.getVtkImageData(parentImageId);
    if (!imageData) throw new Error('No such parent image');

    const baseName =
      imageCacheStore.getImageMetadata(parentImageId)?.name ?? NO_NAME;
    return registerArtifact(allocateMask(imageData, extent), {
      parentImage: parentImageId,
      name: name ?? artifactNamer.pick(parentImageId, baseName),
      ...(source ? { source } : {}),
    });
  }

  function updateArtifactMeta(
    artifactId: string,
    patch: Partial<ArtifactMetadata>
  ) {
    const meta = artifactMeta[artifactId];
    if (!meta) throw new Error('No such artifact');
    artifactMeta[artifactId] = { ...meta, ...patch };
  }

  function detachSegment(segmentation: Segmentation, segmentId: string) {
    removeFromArray(segmentation.order, segmentId);
    delete segmentation.segments[segmentId];
  }

  function removeArtifact(artifactId: string) {
    const meta = artifactMeta[artifactId];
    if (!meta) return;

    const segmentation = getSegmentationForImage(meta.parentImage);
    if (segmentation) {
      segmentsForArtifact(artifactId).forEach((segment) =>
        detachSegment(segmentation, segment.id)
      );
    }

    delete artifactIndex[artifactId];
    delete artifactMeta[artifactId];
  }

  /**
   * Label values stay unique among the segments of one parent image, and have
   * to fit in a mask byte. Exhausting them refuses the allocation rather than
   * handing back a value that writes as background.
   */
  function nextLabelValue(segmentation: Segmentation, preferred?: number) {
    const used = new Set(
      listSegments(segmentation).flatMap((segment) =>
        segment.representations.labelmap
          ? [segment.representations.labelmap.labelValue]
          : []
      )
    );
    if (
      preferred !== undefined &&
      preferred > LABELMAP_BACKGROUND_VALUE &&
      preferred <= LABELMAP_MAX_VALUE &&
      !used.has(preferred)
    ) {
      return preferred;
    }
    let labelValue = LABELMAP_BACKGROUND_VALUE + 1;
    while (used.has(labelValue)) labelValue += 1;
    if (labelValue > LABELMAP_MAX_VALUE) {
      throw new Error(
        `An image holds at most ${LABELMAP_MAX_VALUE} segments with voxels`
      );
    }
    return labelValue;
  }

  /**
   * Mints one segment per descriptor and fills its bounded mask. The segments
   * share one segmentation, so label values are assigned against what is
   * already in it and a taken value gets remapped.
   */
  function splitLabelmapIntoSegments(
    parentImageId: string,
    labelmap: vtkLabelMap,
    descriptors: LabelmapSegment[],
    options: { source?: ProcessingResultSource; artifactName?: string } = {}
  ) {
    const segmentation = ensureSegmentationForImage(parentImageId);
    const created: Segment[] = [];

    splitLabelmap(labelmap, descriptors, (descriptor, extent) => {
      const segment = createSegment(segmentation.id, {
        name: descriptor.name,
        color: [...descriptor.color] as RGBAColor,
      });
      segment.visible = descriptor.visible;
      segment.locked = descriptor.locked ?? false;

      const labelValue = nextLabelValue(segmentation, descriptor.value);
      const artifactId = createArtifactForImage(
        parentImageId,
        extent,
        options.source,
        options.artifactName
      );
      segment.representations.labelmap = { artifactId, labelValue, extent };
      created.push(segment);

      return { labelValue, mask: maskScalars(artifactIndex[artifactId]) };
    });

    return created;
  }

  // Deliberately separate from createSegment's cursor: a descriptor-less
  // labelmap must decode to the same catalog whether it came from a cold
  // restore or a live conversion, regardless of how many segments this
  // session has otherwise created.
  let nextDecodeColorIndex = 0;
  function getNextDecodeColor() {
    const color = CATEGORICAL_COLORS[nextDecodeColorIndex];
    nextDecodeColorIndex =
      (nextDecodeColorIndex + 1) % CATEGORICAL_COLORS.length;
    return [...color, 255] as const;
  }

  function decodeSegments(
    imageId: DataSelection | undefined,
    image: vtkLabelMap,
    options: { component?: number; headerMetadata?: Map<string, string> } = {}
  ) {
    return decodeLabelmapSegments(imageId, image, {
      ...options,
      // A descriptor-less labelmap reads as the file it arrived in, not as
      // 'Segment N'; the cold restore decodes through here too, so the two
      // paths keep naming one labelmap alike.
      baseName: imageId === undefined ? undefined : getSelectionStem(imageId),
      nextColor: getNextDecodeColor,
    });
  }

  function convertImageToLabelmap(
    imageID: DataSelection,
    parentID: DataSelection,
    source?: ArtifactMetadata['source']
  ) {
    return importLabelmapImage(imageID, parentID, {
      decode: (labelmap, component) =>
        decodeSegments(imageID, labelmap, { component }) as Promise<
          LabelmapSegment[]
        >,
      split: (labelmap, descriptors) =>
        splitLabelmapIntoSegments(parentID, labelmap, descriptors, {
          source,
        }).map((segment) => segment.id),
    });
  }

  const saveFormat = ref('vti');

  /** The single voxel-allocation point: no other operation creates storage. */
  function ensureLabelmapBinding(segmentId: string) {
    const segmentation = getSegmentationOf(segmentId);
    const segment = segmentation.segments[segmentId];
    if (segment.representations.labelmap)
      return segment.representations.labelmap;

    // The value is claimed before the mask exists: exhausting the values throws,
    // and an artifact minted first would outlive the refused binding.
    const labelValue = nextLabelValue(segmentation);
    segment.representations.labelmap = {
      artifactId: createArtifactForImage(segmentation.parentImageId),
      labelValue,
      extent: emptyExtent(),
    };
    return segment.representations.labelmap;
  }

  /** The binding of a segment that may already be gone. */
  const findSegmentBinding = (segmentId: string) =>
    findSegment(segmentId)?.representations.labelmap;

  function resolveLabelmapBinding(segmentId: string) {
    const binding = getSegment(segmentId).representations.labelmap;
    if (!binding) return undefined;
    return { ...toRaw(binding), labelmap: artifactIndex[binding.artifactId] };
  }

  /** Grows one mask, in place, to cover `extent` in parent index space. */
  function ensureArtifactContains(artifactId: string, extent: Extent3D) {
    const mask = artifactIndex[artifactId];
    const meta = artifactMeta[artifactId];
    if (!mask || !meta) throw new Error('No such artifact');
    if (isEmptyExtent(extent)) return false;

    const parent = imageCacheStore.getVtkImageData(meta.parentImage);
    if (!parent) throw new Error('No such parent image');
    // Refused before anything is touched, so a rejected growth leaves the mask
    // exactly as it was.
    if (!extentContains(fullExtent(parent.getDimensions()), extent))
      throw new Error('Extent leaves the parent image');

    const binding =
      segmentsForArtifact(artifactId)[0]?.representations.labelmap;
    if (!binding) throw new Error('No segment bound to this artifact');

    const current = binding.extent;
    if (!isEmptyExtent(current) && extentContains(current, extent))
      return false;

    const grown = isEmptyExtent(current)
      ? ([...extent] as Extent3D)
      : extentUnion(current, extent);
    regrowMask(mask, parent, current, grown);
    binding.extent = grown;
    return true;
  }

  /**
   * The voxel half of the accessor seam, over whichever mask `findArtifactId`
   * resolves. Resolution is deferred to every call so a stale accessor sees
   * deletion or growth done through another one. `onMissing` names why storage
   * is unreachable, so `exists()` can answer without throwing.
   */
  function voxelStorage(
    findArtifactId: () => Maybe<string>,
    onMissing: () => never
  ): VoxelStorage {
    const findImage = () => {
      const artifactId = findArtifactId();
      return artifactId ? artifactIndex[artifactId] : undefined;
    };
    const requireImage = () => findImage() ?? onMissing();
    const requireScalars = () => maskScalars(requireImage());

    return {
      exists: () => !!findImage(),
      image: requireImage,
      scalars: requireScalars,
      snapshot: () => requireScalars().slice(),
      apply: (scalars: TypedArray | number[]) => {
        const image = requireImage();
        const data = maskScalars(image);
        if (scalars.length !== data.length) {
          throw new Error('Scalar length does not match storage');
        }
        data.set(scalars);
        image.modified();
      },
      ensureContains: (extent: Extent3D) => {
        requireImage();
        return ensureArtifactContains(findArtifactId()!, extent);
      },
    };
  }

  /**
   * The accessor every labelmap consumer that holds a segment routes through.
   * The binding is re-resolved on every call rather than captured.
   */
  function segmentVoxels(segmentId: string): SegmentVoxelAccessor {
    // Validates eagerly: an accessor for a nonexistent segment is refused up
    // front, not just on first use.
    getSegment(segmentId);

    const binding = () => getSegment(segmentId).representations.labelmap;

    // Deliberately tolerant where binding() is not: the segment itself can be
    // deleted out from under an accessor, and that is an absent storage, not a
    // lookup error.
    const findArtifactId = () =>
      findSegment(segmentId)?.representations.labelmap?.artifactId;

    const onMissing = (): never => {
      if (!binding()) throw new Error('No storage: call materialize() first');
      throw new Error('No such artifact');
    };

    return {
      binding,
      materialize: () => ensureLabelmapBinding(segmentId),
      ...voxelStorage(findArtifactId, onMissing),
    };
  }

  /**
   * The accessor for consumers that hold an artifact and no segment. Stays
   * constructible for an artifact that is gone: the renderer and the paint
   * widget are computeds keyed on an id that can vanish a tick before they do.
   */
  function artifactVoxels(artifactId: string) {
    return voxelStorage(
      () => (artifactIndex[artifactId] ? artifactId : undefined),
      () => {
        throw new Error('No such artifact');
      }
    );
  }

  /**
   * A bound segment's buffer with the strides its extent implies. The extent is
   * copied out of the reactive tree because the callers read it per voxel.
   */
  function boundedMask(binding: LabelmapBinding) {
    const mask = artifactIndex[binding.artifactId];
    if (!mask || isEmptyExtent(binding.extent)) return undefined;
    const extent = [...binding.extent] as Extent3D;
    const [mi, mj] = extentSize(extent);
    return { mask, scalars: maskScalars(mask), extent, mi, mj };
  }

  /**
   * The masks of an image's other segments, resolved once per stroke because
   * the callers below run per voxel.
   */
  function siblingMasks(
    segmentId: string,
    only?: (segment: Segment) => boolean
  ) {
    const segmentation = segmentationOf(segmentId);
    if (!segmentation) return [];
    return listSegments(segmentation).flatMap((segment) => {
      if (segment.id === segmentId) return [];
      if (only && !only(segment)) return [];
      const binding = segment.representations.labelmap;
      const bounded = binding ? boundedMask(binding) : undefined;
      return bounded ? [bounded] : [];
    });
  }

  /**
   * Overwrite-all across N masks: one shared labelmap erased a voxel's old
   * value for free, so a write path clears the voxel in every other mask of the
   * same parent image itself. Coordinates are PARENT indices. A sibling that
   * does not reach the voxel has nothing there to clear, so nothing grows.
   */
  function otherSegmentClearer(segmentId: string) {
    const siblings = siblingMasks(segmentId);
    return (i: number, j: number, k: number) => {
      siblings.forEach((sibling) => {
        if (!extentContainsIndex(sibling.extent, i, j, k)) return;
        const offset = maskOffset(sibling, i, j, k);
        if (sibling.scalars[offset] === LABELMAP_BACKGROUND_VALUE) return;
        sibling.scalars[offset] = LABELMAP_BACKGROUND_VALUE;
        sibling.mask.modified();
      });
    };
  }

  /** Whether a locked segment of the same image already owns a parent voxel. */
  function lockedSegmentAt(segmentId: string) {
    const locked = siblingMasks(segmentId, (segment) => segment.locked);
    return (i: number, j: number, k: number) =>
      locked.some(
        (sibling) =>
          extentContainsIndex(sibling.extent, i, j, k) &&
          sibling.scalars[maskOffset(sibling, i, j, k)] !==
            LABELMAP_BACKGROUND_VALUE
      );
  }

  /**
   * The image's segments as one parent-shaped labelmap, built on demand and
   * never stored: what leaves VolView means the whole segmentation, not one
   * segment's bounded mask. Later in `order` wins where two segments overlap,
   * which is how their actors stack.
   */
  function compositeLabelmap(parentImageId: string) {
    const parent = imageCacheStore.getVtkImageData(parentImageId);
    if (!parent) throw new Error('No such parent image');

    const dimensions = parent.getDimensions();
    const labelmap = allocateMask(parent, fullExtent(dimensions));
    const values = maskScalars(labelmap);

    const segmentation = getSegmentationForImage(parentImageId);
    const segments: LabelmapSegment[] = [];
    (segmentation ? listSegments(segmentation) : []).forEach((segment) => {
      const binding = segment.representations.labelmap;
      if (!binding) return;
      segments.push(toLabelmapSegment(segment, binding.labelValue));

      const bounded = boundedMask(binding);
      if (!bounded) return;
      const { scalars: source, extent } = bounded;
      for (let k = extent[4]; k <= extent[5]; k += 1) {
        for (let j = extent[2]; j <= extent[3]; j += 1) {
          for (let i = extent[0]; i <= extent[1]; i += 1) {
            const value = source[maskOffset(bounded, i, j, k)];
            if (value === LABELMAP_BACKGROUND_VALUE) continue;
            values[i + j * dimensions[0] + k * dimensions[0] * dimensions[1]] =
              value;
          }
        }
      }
    });

    labelmap.setSegments(segments);
    return { labelmap, segments };
  }

  /** The bound segments of an image, keyed by the label value their mask holds. */
  function boundSegmentsByLabelValue(parentImageId: string) {
    const segmentation = getSegmentationForImage(parentImageId);
    const owners = new Map<number, Segment>();
    (segmentation ? listSegments(segmentation) : []).forEach((segment) => {
      const binding = segment.representations.labelmap;
      if (binding) owners.set(binding.labelValue, segment);
    });
    return owners;
  }

  /**
   * Writes a composite edit back into the bounded masks it was built from.
   * Only voxels the edit actually changed are touched, so an overlap the
   * composite could not show survives a process that never aimed at it. A
   * changed voxel is stated in full: it ends up holding the edit's value and
   * nothing else, so the composite reads back what was written into it.
   */
  function applyCompositeEdit(
    parentImageId: string,
    before: Uint8Array,
    after: TypedArray | number[]
  ) {
    const parent = imageCacheStore.getVtkImageData(parentImageId);
    if (!parent) throw new Error('No such parent image');
    const [di, dj, dk] = parent.getDimensions();
    const owners = boundSegmentsByLabelValue(parentImageId);

    // Growth happens first, and nothing grows once the buffers below are read.
    const needed = new Map<number, Extent3D>();
    for (let k = 0; k < dk; k += 1) {
      for (let j = 0; j < dj; j += 1) {
        for (let i = 0; i < di; i += 1) {
          const offset = i + j * di + k * di * dj;
          const value = after[offset];
          if (value === LABELMAP_BACKGROUND_VALUE || value === before[offset])
            continue;
          const voxel: Extent3D = [i, i, j, j, k, k];
          const box = needed.get(value);
          needed.set(value, box ? extentUnion(box, voxel) : voxel);
        }
      }
    }
    needed.forEach((extent, value) => {
      const owner = owners.get(value);
      if (owner)
        ensureArtifactContains(
          owner.representations.labelmap!.artifactId,
          extent
        );
    });

    const targets = new Map<
      number,
      {
        mask: vtkLabelMap;
        scalars: Uint8Array;
        extent: Extent3D;
        mi: number;
        mj: number;
      }
    >();
    owners.forEach((segment, value) => {
      const binding = segment.representations.labelmap!;
      const mask = artifactIndex[binding.artifactId];
      if (!mask || isEmptyExtent(binding.extent)) return;
      const extent = [...binding.extent] as Extent3D;
      const [mi, mj] = extentSize(extent);
      targets.set(value, { mask, scalars: maskScalars(mask), extent, mi, mj });
    });

    const touched = new Set<vtkLabelMap>();
    const write = (
      value: number,
      i: number,
      j: number,
      k: number,
      next: number
    ) => {
      const target = targets.get(value);
      if (!target || !extentContainsIndex(target.extent, i, j, k)) return;
      const offset =
        i -
        target.extent[0] +
        (j - target.extent[2]) * target.mi +
        (k - target.extent[4]) * target.mi * target.mj;
      if (target.scalars[offset] === next) return;
      target.scalars[offset] = next;
      touched.add(target.mask);
    };

    // Read once: the loop below visits every one of these per changed voxel.
    const owned = [...targets.keys()];
    const clear = LABELMAP_BACKGROUND_VALUE;

    for (let k = 0; k < dk; k += 1) {
      for (let j = 0; j < dj; j += 1) {
        for (let i = 0; i < di; i += 1) {
          const offset = i + j * di + k * di * dj;
          const next = after[offset];
          if (next === before[offset]) continue;
          // A changed voxel is stated in full: the mask the edit names takes
          // it and every other mask releases it, so an overlap the composite
          // could not show cannot resurface as the value the edit dropped.
          owned.forEach((value) =>
            write(value, i, j, k, value === next ? next : clear)
          );
        }
      }
    }

    touched.forEach((mask) => mask.modified());
  }

  /**
   * Voxel access to an image's segments as one parent-shaped buffer, for the
   * processes whose scope is every segment at once. The composite is a read
   * model built once per accessor; a write is diffed against it and
   * distributed back into the bounded masks that own each voxel.
   */
  function imageVoxels(parentImageId: string): VoxelStorage {
    let composite: vtkLabelMap | undefined;

    const exists = () =>
      !!imageCacheStore.getVtkImageData(parentImageId) &&
      segmentLayersForImage(parentImageId).length > 0;

    const requireComposite = () => {
      if (!exists()) throw new Error('No segmentation for this image');
      composite ??= compositeLabelmap(parentImageId).labelmap;
      return composite;
    };
    const scalars = () => maskScalars(requireComposite());

    return {
      exists,
      image: requireComposite,
      scalars,
      snapshot: () => scalars().slice(),
      apply: (values: TypedArray | number[]) => {
        const current = scalars();
        if (values.length !== current.length) {
          throw new Error('Scalar length does not match storage');
        }
        applyCompositeEdit(parentImageId, current, values);
        // The read model tracks what the masks now hold, so the next write
        // diffs against the state this one left.
        current.set(values);
        requireComposite().modified();
      },
      // The composite spans the parent, so there is nothing to grow.
      ensureContains: () => false,
    };
  }

  /** The label values of an image's locked segments. */
  function lockedLabelValues(parentImageId: string) {
    const owners = boundSegmentsByLabelValue(parentImageId);
    return [...owners.entries()].flatMap(([labelValue, segment]) =>
      segment.locked ? [labelValue] : []
    );
  }

  /** The segments of an image that have a mask, with their place in `order`. */
  function segmentLayersForImage(parentImageId: string) {
    const segmentation = getSegmentationForImage(parentImageId);
    if (!segmentation) return [];
    return listSegments(segmentation).flatMap((segment, stackIndex) => {
      const { artifactId } = segment.representations.labelmap ?? {};
      return artifactId
        ? [{ segmentId: segment.id, artifactId, stackIndex }]
        : [];
    });
  }

  function updateSegment(segmentId: string, patch: SegmentPatch) {
    const { segments } = getSegmentationOf(segmentId);
    segments[segmentId] = { ...toRaw(segments[segmentId]), ...patch };
  }

  const updateSegmentationDisplay = (
    segmentationId: string,
    patch: SegmentationDisplayPatch
  ) => Object.assign(getSegmentation(segmentationId), patch);

  function reorderSegments(segmentationId: string, order: string[]) {
    getSegmentation(segmentationId).order = [...order];
  }

  function deleteSegment(segmentId: string) {
    const segmentation = getSegmentationOf(segmentId);
    const binding = segmentation.segments[segmentId].representations.labelmap;

    detachSegment(segmentation, segmentId);

    // The mask holds this segment and nothing else, so it goes with it.
    if (binding) removeArtifact(binding.artifactId);
  }

  function removeSegmentation(segmentationId: string) {
    const segmentation = segmentations[segmentationId];
    if (!segmentation) return;

    const { parentImageId } = segmentation;
    delete byParentImage[parentImageId];
    delete segmentations[segmentationId];

    removeArtifactsForImage(parentImageId);
  }

  function removeArtifactsForImage(parentImageId: string) {
    Object.keys(artifactMeta)
      .filter(
        (artifactId) => artifactMeta[artifactId].parentImage === parentImageId
      )
      .forEach(removeArtifact);
  }

  // --- active target and cross-image intent --- //

  const activeSegmentRef = shallowRef<Maybe<string>>();

  // Session-only, never serialized: which segment the user means, and where
  // that intent has already landed per image.
  const intent = shallowRef<Maybe<ActiveSegmentIntent>>();

  // Tool stores read it to tell a template intent from a materialized one.
  const activeSegmentIntent = computed(() => intent.value);

  // The segment an edit just minted for the intent, and where its identity came
  // from. Per-tool props are the tool store's own, so it carries them onto the
  // new segment on this signal: from the config template on the first edit,
  // from the origin segment on every later cross-image clone.
  const mintedSegment = shallowRef<
    Maybe<{
      segmentId: string;
      templateName?: string;
      fromSegmentId?: string;
    }>
  >();

  // A segment that is gone (deleted, or its catalog replaced) is not active.
  const activeSegmentId = computed(() =>
    activeSegmentRef.value && findSegment(activeSegmentRef.value)
      ? activeSegmentRef.value
      : undefined
  );

  function setActiveSegment(segmentId: string) {
    const imageId = getSegmentationOf(segmentId).parentImageId;

    // Reselecting where the intent already landed restates the same intent, so
    // the other images keep their records and a later edit there reuses the
    // clone instead of making a second one.
    const landed = intent.value?.targetByImageId;
    const sameIntent = landed?.[imageId] === segmentId;

    intent.value = {
      originSegmentId: segmentId,
      targetByImageId: sameIntent
        ? { ...landed, [imageId]: segmentId }
        : { [imageId]: segmentId },
    };
    activeSegmentRef.value = segmentId;
  }

  /** What the intent means right now: the origin's live identity, or its template. */
  function heldIdentity() {
    const held = intent.value;
    if (!held) return undefined;
    const origin = held.originSegmentId
      ? findSegment(held.originSegmentId)
      : undefined;
    return origin ?? held.template;
  }

  /**
   * States an intent that has no segment yet: a config template the user
   * picked. The first edit materializes it, so nothing is allocated here.
   */
  function setActiveSegmentTemplate(template: SegmentIdentity) {
    const identity = {
      name: template.name,
      color: [...template.color] as RGBAColor,
    };
    const current = intent.value;
    const held = heldIdentity();

    // Restating the intent already held keeps the images it landed on, so a
    // later edit there reuses that clone instead of minting a second one.
    if (current && held && sameIdentity(held, identity)) {
      intent.value = { ...current, template: identity };
      return;
    }

    intent.value = { template: identity, targetByImageId: {} };
    activeSegmentRef.value = undefined;
  }

  function clearActiveSegment() {
    intent.value = undefined;
    activeSegmentRef.value = undefined;
  }

  /** The artifact the active segment writes into, once it has storage. */
  const activeArtifactId = computed(() => {
    const segmentId = activeSegmentId.value;
    if (!segmentId) return undefined;
    return findSegment(segmentId)?.representations.labelmap?.artifactId;
  });

  /** The segmentation the active segment belongs to. */
  const activeSegmentationId = computed(() => {
    const segmentId = activeSegmentId.value;
    return segmentId ? segmentationOf(segmentId)?.id : undefined;
  });

  /**
   * The one entry point every edit path calls at operation time. Only this
   * creates a segment; setting an active segment or viewing another image
   * never does. Storage stays deferred to ensureLabelmapBinding.
   */
  /** Whether a segment id is live anywhere, used to tell stale ids from foreign ones. */
  const segmentExists = (segmentId: string) => !!findSegment(segmentId);

  /**
   * The segment an edit would target, if it already exists. Creates nothing, so
   * an operation with nothing to allocate for, erasing above all, can refuse
   * before a segment is minted.
   */
  function findEditTarget(imageId: string, preferredSegmentId?: Maybe<string>) {
    // An explicit segment wins when it belongs to this image. Anything else, a
    // stale id included, falls through to the recorded target.
    const owner = getSegmentationForImage(imageId);
    if (preferredSegmentId && owner?.segments[preferredSegmentId])
      return preferredSegmentId;

    const recorded = intent.value?.targetByImageId[imageId];
    return recorded && findSegment(recorded) ? recorded : undefined;
  }

  function resolveEditTarget(
    imageId: string,
    preferredSegmentId?: Maybe<string>
  ) {
    const existing = findEditTarget(imageId, preferredSegmentId);
    if (existing) {
      // A recorded target is this image's selection, so editing it selects it.
      // Naming a segment to edit is not selecting it.
      if (existing !== preferredSegmentId) activeSegmentRef.value = existing;
      return existing;
    }

    // Identity is copied, never matched: a same-named segment is not the same
    // segment. The origin is read now, not when it was selected, so a rename
    // since then carries across.
    const origin = intent.value?.originSegmentId
      ? findSegment(intent.value.originSegmentId)
      : undefined;
    const template = origin ? undefined : intent.value?.template;
    const { name, color } = origin ?? template ?? DEFAULT_SEGMENT_MASKS[0];
    const segmentation = ensureSegmentationForImage(imageId);
    const segment = createSegment(segmentation.id, { name, color });
    // A template or a bare default has no origin, so the segment just made
    // becomes one: the next image clones this identity, not the default again.
    intent.value = {
      originSegmentId: origin?.id ?? segment.id,
      targetByImageId: {
        ...intent.value?.targetByImageId,
        [imageId]: segment.id,
      },
    };
    activeSegmentRef.value = segment.id;
    mintedSegment.value = {
      segmentId: segment.id,
      ...(template ? { templateName: template.name } : {}),
      ...(origin ? { fromSegmentId: origin.id } : {}),
    };
    return segment.id;
  }

  // --- render sync --- //

  // The labelmap renderer colors by voxel value, so each artifact receives the
  // value-keyed projection of the segments bound to it.
  const labelmapSegmentsByArtifact = computed(() => {
    const byArtifact: Record<string, LabelmapSegment[]> = {};
    Object.keys(artifactMeta).forEach((artifactId) => {
      byArtifact[artifactId] = [];
    });
    Object.values(segmentations).forEach((segmentation) => {
      listSegments(segmentation).forEach((segment) => {
        const binding = segment.representations.labelmap;
        if (!binding || !byArtifact[binding.artifactId]) return;
        byArtifact[binding.artifactId].push(
          toLabelmapSegment(segment, binding.labelValue)
        );
      });
    });
    return byArtifact;
  });

  watch(
    labelmapSegmentsByArtifact,
    (byArtifact) => {
      Object.entries(byArtifact).forEach(([artifactId, segments]) => {
        artifactIndex[artifactId]?.setSegments(segments);
      });
    },
    { immediate: true }
  );

  // --- state file --- //

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

    const activeId = activeSegmentId.value;
    manifest.segmentations = Object.values(segmentations).map(
      (segmentation) => ({
        id: segmentation.id,
        name: segmentation.name,
        parentImage: segmentation.parentImageId,
        fillOpacity: segmentation.fillOpacity,
        outlineOpacity: segmentation.outlineOpacity,
        outlineThickness: segmentation.outlineThickness,
        segments: listSegments(segmentation).map((segment) => {
          const binding = segment.representations.labelmap;
          return {
            id: segment.id,
            name: segment.name,
            color: [...segment.color] as RGBAColor,
            visible: segment.visible,
            locked: segment.locked,
            fillOpacity: segment.fillOpacity,
            outlineOpacity: segment.outlineOpacity,
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
        ...(activeId && segmentation.segments[activeId]
          ? { activeSegment: activeId }
          : {}),
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

  async function deserialize(
    manifest: Manifest,
    stateFiles: FileEntry[],
    dataIDMap: Record<string, string>,
    // Per-artifact restore source, resolved by the restore setup (see
    // resolveArtifactRestoreSources in restoreStateFile.ts, the single owner of
    // the synthesized-leaf and ownership policy). Mapped through dataIDMap here.
    artifactSources: Record<string, ArtifactRestoreSource> = {},
    io: SegmentationArtifactIO = defaultArtifactIO
  ) {
    const wireArtifacts = manifest.segmentationArtifacts ?? [];
    const artifactIdMap: Record<string, string> = {};
    const segmentIdMap: Record<string, string> = {};
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

    // Skip BEFORE awaiting anything an artifact whose parent image is
    // unresolved, or a path-less one whose datasource never materialized —
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
            const labelmap = toLabelMap(image);
            // A migrated group that carried no descriptors is enumerated here,
            // through the same decode live import uses, while its source image
            // is still loaded: the temp artifact dataset is dropped below.
            const decoded = artifact.pendingDecode
              ? ((await decodeSegments(storeId, labelmap, {
                  headerMetadata,
                })) as LabelmapSegment[])
              : undefined;
            return { artifact, labelmap, decoded };
          } catch {
            // A parse/read failure skips just this artifact — never rejects the
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
        result &&
        (result.artifact.pendingDecode || result.artifact.pendingSplit)
          ? [artifactIdMap[result.artifact.id]]
          : []
      )
    );

    (manifest.segmentations ?? []).forEach((wire) => {
      const parentImageId = dataIDMap[wire.parentImage];
      if (parentImageId === undefined) return;
      const parentImage = imageCacheStore.getVtkImageData(parentImageId);

      const segmentation = ensureSegmentationForImage(parentImageId);
      segmentation.name = wire.name;
      segmentation.fillOpacity = wire.fillOpacity;
      segmentation.outlineOpacity = wire.outlineOpacity;
      segmentation.outlineThickness = wire.outlineThickness;

      // A mask sits on its parent's grid, so a binding to another image's
      // artifact is not storage a segment here can be read or written through.
      const ownsArtifact = (artifactId: string) =>
        artifactMeta[artifactId]?.parentImage === parentImageId;

      const wireById = new Map(
        wire.segments.map((segment) => [segment.id, segment])
      );
      wire.order.forEach((wireSegmentId) => {
        const wireSegment = wireById.get(wireSegmentId);
        if (!wireSegment) return;

        const segment = createSegment(segmentation.id, {
          name: wireSegment.name,
          color: [...wireSegment.color] as RGBAColor,
        });
        segment.visible = wireSegment.visible;
        segment.locked = wireSegment.locked;
        segment.fillOpacity = wireSegment.fillOpacity;
        segment.outlineOpacity = wireSegment.outlineOpacity;

        const binding = wireSegment.representations.labelmap;
        const artifactId = binding
          ? artifactIdMap[binding.artifactId]
          : undefined;
        if (binding && artifactId !== undefined && ownsArtifact(artifactId)) {
          const extent = [...binding.extent] as Extent3D;
          segment.representations.labelmap = {
            artifactId,
            labelValue: binding.labelValue,
            extent,
          };
          // The mask that covers nothing was written as a placeholder voxel;
          // the extent is what says it covers nothing.
          if (
            isEmptyExtent(extent) &&
            parentImage &&
            !artifactsToSplit.has(artifactId)
          ) {
            placeMask(artifactIndex[artifactId], parentImage, extent);
            setMaskScalars(artifactIndex[artifactId], new Uint8Array(0));
          }
        }
        segmentIdMap[wireSegmentId] = segment.id;
      });

      const restoredActiveId = wire.activeSegment
        ? segmentIdMap[wire.activeSegment]
        : undefined;
      if (restoredActiveId !== undefined) setActiveSegment(restoredActiveId);
    });

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
      const migrated = segmentsForArtifact(artifactId);
      const descriptors =
        result.decoded ??
        migrated.map((segment) =>
          toLabelmapSegment(
            segment,
            segment.representations.labelmap!.labelValue
          )
        );

      // The source goes first, so the split segments can take the label values
      // the migrated ones were holding.
      const parentImageId = dataIDMap[artifact.parentImage];
      const segmentation = ensureSegmentationForImage(parentImageId);
      const orderBefore = [...segmentation.order];
      const labelmap = artifactIndex[artifactId];
      const migratedIds = migrated.map((segment) => segment.id);
      const wireIdByStoreId = new Map(
        Object.entries(segmentIdMap).map(([wireId, storeId]) => [
          storeId,
          wireId,
        ])
      );
      const activeBefore = activeSegmentRef.value;
      removeArtifact(artifactId);

      const created = splitLabelmapIntoSegments(
        parentImageId,
        labelmap,
        descriptors,
        { source: artifact.source, artifactName: artifact.name }
      );

      // Every reference to a segment that went with the source artifact moves
      // onto the split one that replaced it, its place in the order included.
      const replacementOf = new Map<string, string>();
      migratedIds.forEach((segmentId, index) => {
        const replacement = created[index];
        if (!replacement) return;
        replacementOf.set(segmentId, replacement.id);
        const wireId = wireIdByStoreId.get(segmentId);
        if (wireId) segmentIdMap[wireId] = replacement.id;
        if (activeBefore === segmentId) setActiveSegment(replacement.id);
      });

      const placed = orderBefore.flatMap((segmentId) => {
        const replacement = replacementOf.get(segmentId);
        if (replacement) return [replacement];
        return segmentation.segments[segmentId] ? [segmentId] : [];
      });
      segmentation.order = [
        ...placed,
        ...created
          .map((segment) => segment.id)
          .filter((segmentId) => !placed.includes(segmentId)),
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
      if (active) setActiveSegment(active.id);
    });

    return { artifactIdMap, segmentIdMap, skipped };
  }

  // --- handle deletions --- //

  onImageDeleted((deleted) => {
    deleted.forEach((parentImageId) => {
      artifactNamer.forget(parentImageId);
      const id = byParentImage[parentImageId];
      if (id) removeSegmentation(id);
      else removeArtifactsForImage(parentImageId);
    });
  });

  return {
    segmentations,
    byParentImage,
    artifactIndex,
    artifactMeta,
    labelmapSegmentsByArtifact,
    activeSegmentId,
    activeSegmentIntent,
    mintedSegment,
    activeArtifactId,
    activeSegmentationId,
    setActiveSegment,
    setActiveSegmentTemplate,
    clearActiveSegment,
    findEditTarget,
    resolveEditTarget,
    segmentExists,
    getSegmentationForImage,
    ensureSegmentationForImage,
    getSegment,
    resolveLabelmapBinding,
    findSegmentBinding,
    segmentVoxels,
    artifactVoxels,
    imageVoxels,
    createSegment,
    ensureLabelmapBinding,
    updateSegment,
    updateSegmentationDisplay,
    reorderSegments,
    deleteSegment,
    removeSegmentation,
    getSegmentationForArtifact,
    segmentsForArtifact,
    registerArtifact,
    createArtifactForImage,
    updateArtifactMeta,
    splitLabelmapIntoSegments,
    decodeSegments,
    convertImageToLabelmap,
    saveFormat,
    otherSegmentClearer,
    lockedSegmentAt,
    compositeLabelmap,
    lockedLabelValues,
    segmentLayersForImage,
    removeArtifact,
    serialize,
    deserialize,
  };
});
