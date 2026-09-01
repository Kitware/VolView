import { defineStore } from 'pinia';
import { markRaw, reactive, toRaw } from 'vue';
import type { RGBAColor } from '@kitware/vtk.js/types';

import { CATEGORICAL_COLORS } from '@/src/config';
import { onImageDeleted } from '@/src/composables/onImageDeleted';
import { useIdStore } from '@/src/store/id';
import { useImageCacheStore } from '@/src/store/image-cache';
import {
  createLabelmapFromImage,
  LABELMAP_BACKGROUND_VALUE,
  makeDefaultSegmentGroupName,
  makeDefaultSegmentName,
} from '@/src/store/segmentGroups';
import type { ProcessingResultSource } from '@/src/types';
import type {
  Extent3D,
  LabelmapBinding,
  Segment,
  Segmentation,
} from '@/src/types/segmentation';
import { removeFromArray } from '@/src/utils';
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

const NO_NAME = '(no name)';

const fullExtent = (dimensions: number[]): Extent3D => [
  0,
  dimensions[0] - 1,
  0,
  dimensions[1] - 1,
  0,
  dimensions[2] - 1,
];

const pickUniqueName = (
  formatName: (index: number) => string,
  taken: Iterable<string>
) => {
  const existing = new Set(taken);
  let index = 1;
  while (existing.has(formatName(index))) index += 1;
  return formatName(index);
};

export const useSegmentationStore = defineStore('segmentation', () => {
  const imageCacheStore = useImageCacheStore();

  const segmentations = reactive<Record<string, Segmentation>>({});
  const byParentImage = reactive<Record<string, string>>({});
  // Internal storage layer: UI and tools reach it through this store's API only.
  const artifactIndex = reactive<Record<string, vtkLabelMap>>({});
  const artifactMeta = reactive<Record<string, ArtifactMetadata>>({});

  let nextColorIndex = 0;
  function getNextColor(): RGBAColor {
    const color = CATEGORICAL_COLORS[nextColorIndex];
    nextColorIndex = (nextColorIndex + 1) % CATEGORICAL_COLORS.length;
    return [...color, 255] as RGBAColor;
  }

  function getSegmentation(segmentationId: string) {
    const segmentation = segmentations[segmentationId];
    if (!segmentation) throw new Error('No such segmentation');
    return segmentation;
  }

  function getSegment(segmentationId: string, segmentId: string) {
    const segment = getSegmentation(segmentationId).segments[segmentId];
    if (!segment) throw new Error('No such segment');
    return segment;
  }

  const listSegments = (segmentation: Segmentation) =>
    segmentation.order.map((id) => segmentation.segments[id]);

  const allBindings = () =>
    Object.values(segmentations)
      .flatMap(listSegments)
      .map((segment) => segment.representations.labelmap)
      .filter((binding): binding is LabelmapBinding => !!binding);

  const bindingsForArtifact = (artifactId: string) =>
    allBindings().filter((binding) => binding.artifactId === artifactId);

  function releaseUnreferencedArtifact(artifactId: string) {
    if (bindingsForArtifact(artifactId).length > 0) return;
    delete artifactIndex[artifactId];
    delete artifactMeta[artifactId];
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
    };
    byParentImage[parentImageId] = id;
    return segmentations[id];
  }

  function createSegment(segmentationId: string, init?: SegmentInit) {
    const segmentation = getSegmentation(segmentationId);
    const id = useIdStore().nextId();
    segmentation.segments[id] = {
      id,
      name:
        init?.name ??
        pickUniqueName(
          makeDefaultSegmentName,
          listSegments(segmentation).map((segment) => segment.name)
        ),
      color: init?.color ? ([...init.color] as RGBAColor) : getNextColor(),
      visible: true,
      locked: false,
      representations: {},
    };
    segmentation.order.push(id);
    return segmentation.segments[id];
  }

  function createArtifact(parentImageId: string) {
    const imageData = imageCacheStore.getVtkImageData(parentImageId);
    if (!imageData) throw new Error('No such parent image');

    const id = useIdStore().nextId();
    artifactIndex[id] = markRaw(createLabelmapFromImage(imageData));
    artifactMeta[id] = {
      parentImage: parentImageId,
      name: pickUniqueName(
        (index) =>
          makeDefaultSegmentGroupName(
            imageCacheStore.getImageMetadata(parentImageId)?.name ?? NO_NAME,
            index
          ),
        Object.values(artifactMeta).map((meta) => meta.name)
      ),
    };
    return id;
  }

  /** The single voxel-allocation point: no other operation creates storage. */
  function ensureLabelmapBinding(segmentationId: string, segmentId: string) {
    const segment = getSegment(segmentationId, segmentId);
    if (segment.representations.labelmap)
      return segment.representations.labelmap;

    const segmentation = getSegmentation(segmentationId);
    const artifactId =
      listSegments(segmentation).find((other) => other.representations.labelmap)
        ?.representations.labelmap?.artifactId ??
      createArtifact(segmentation.parentImageId);

    const used = new Set(
      bindingsForArtifact(artifactId).map((binding) => binding.labelValue)
    );
    let labelValue = LABELMAP_BACKGROUND_VALUE + 1;
    while (used.has(labelValue)) labelValue += 1;

    segment.representations.labelmap = {
      artifactId,
      labelValue,
      extent: fullExtent(artifactIndex[artifactId].getDimensions()),
    };
    return segment.representations.labelmap;
  }

  function resolveLabelmapBinding(segmentationId: string, segmentId: string) {
    const binding = getSegment(segmentationId, segmentId).representations
      .labelmap;
    if (!binding) return undefined;
    return { ...toRaw(binding), labelmap: artifactIndex[binding.artifactId] };
  }

  function updateSegment(
    segmentationId: string,
    segmentId: string,
    patch: SegmentPatch
  ) {
    const segmentation = getSegmentation(segmentationId);
    segmentation.segments[segmentId] = {
      ...toRaw(getSegment(segmentationId, segmentId)),
      ...patch,
    };
  }

  function reorderSegments(segmentationId: string, order: string[]) {
    getSegmentation(segmentationId).order = [...order];
  }

  function deleteSegment(segmentationId: string, segmentId: string) {
    const segmentation = getSegmentation(segmentationId);
    const binding = getSegment(segmentationId, segmentId).representations
      .labelmap;

    removeFromArray(segmentation.order, segmentId);
    delete segmentation.segments[segmentId];

    if (!binding) return;
    artifactIndex[binding.artifactId].replaceLabelValue(
      binding.labelValue,
      LABELMAP_BACKGROUND_VALUE
    );
    releaseUnreferencedArtifact(binding.artifactId);
  }

  function removeSegmentation(segmentationId: string) {
    const segmentation = segmentations[segmentationId];
    if (!segmentation) return;

    const artifactIds = new Set(
      listSegments(segmentation)
        .map((segment) => segment.representations.labelmap?.artifactId)
        .filter((id): id is string => !!id)
    );

    delete byParentImage[segmentation.parentImageId];
    delete segmentations[segmentationId];

    artifactIds.forEach(releaseUnreferencedArtifact);
  }

  onImageDeleted((deleted) => {
    deleted.forEach((parentImageId) => {
      const id = byParentImage[parentImageId];
      if (id) removeSegmentation(id);
    });
  });

  return {
    segmentations,
    byParentImage,
    artifactIndex,
    artifactMeta,
    getSegmentationForImage,
    ensureSegmentationForImage,
    getSegment,
    resolveLabelmapBinding,
    createSegment,
    ensureLabelmapBinding,
    updateSegment,
    reorderSegments,
    deleteSegment,
    removeSegmentation,
  };
});
