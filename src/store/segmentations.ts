import { defineStore } from 'pinia';
import { computed, markRaw, reactive, toRaw, watch } from 'vue';
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
  LabelmapSegment,
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

const pickUniqueSegmentName = (taken: Iterable<string>) => {
  const existing = new Set(taken);
  let index = 1;
  while (existing.has(makeDefaultSegmentName(index))) index += 1;
  return makeDefaultSegmentName(index);
};

export const useSegmentationStore = defineStore('segmentation', () => {
  const imageCacheStore = useImageCacheStore();

  const segmentations = reactive<Record<string, Segmentation>>({});
  const byParentImage = reactive<Record<string, string>>({});
  // Internal storage layer: UI and tools reach it through this store's API only.
  const artifactIndex = reactive<Record<string, vtkLabelMap>>({});
  const artifactMeta = reactive<Record<string, ArtifactMetadata>>({});
  const artifactOrderByParent = reactive<Record<string, string[]>>({});

  let nextColorIndex = 0;
  function getNextColor(): RGBAColor {
    const color = CATEGORICAL_COLORS[nextColorIndex];
    nextColorIndex = (nextColorIndex + 1) % CATEGORICAL_COLORS.length;
    return [...color, 255] as RGBAColor;
  }

  // Names keep counting up per parent image so a deleted artifact's name is
  // not immediately handed to the next one. Cleared by the deletion cascade.
  const nextDefaultIndex: Record<string, number> = Object.create(null);

  function pickUniqueArtifactName(
    formatName: (index: number) => string,
    parentImageId: string
  ) {
    const existing = new Set(
      Object.values(artifactMeta).map((meta) => meta.name)
    );
    let name = '';
    do {
      const nameIndex = nextDefaultIndex[parentImageId] ?? 1;
      nextDefaultIndex[parentImageId] = nameIndex + 1;
      name = formatName(nameIndex);
    } while (existing.has(name));
    return name;
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
        pickUniqueSegmentName(
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

  const artifactsForImage = (parentImageId: string) =>
    artifactOrderByParent[parentImageId] ?? [];

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

  function findSegmentByLabelValue(artifactId: string, labelValue: number) {
    return segmentsForArtifact(artifactId).find(
      (segment) => segment.representations.labelmap?.labelValue === labelValue
    );
  }

  function registerArtifact(labelmap: vtkLabelMap, meta: ArtifactMetadata) {
    const id = useIdStore().nextId();
    artifactIndex[id] = markRaw(labelmap);
    artifactMeta[id] = { ...meta };
    artifactOrderByParent[meta.parentImage] ??= [];
    artifactOrderByParent[meta.parentImage].push(id);
    return id;
  }

  /** Allocates an empty labelmap shaped like the parent image. */
  function createArtifactForImage(parentImageId: string) {
    const imageData = imageCacheStore.getVtkImageData(parentImageId);
    if (!imageData) throw new Error('No such parent image');

    const baseName =
      imageCacheStore.getImageMetadata(parentImageId)?.name ?? NO_NAME;
    return registerArtifact(createLabelmapFromImage(imageData), {
      parentImage: parentImageId,
      name: pickUniqueArtifactName(
        (index) => makeDefaultSegmentGroupName(baseName, index),
        parentImageId
      ),
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

    removeFromArray(artifactOrderByParent[meta.parentImage] ?? [], artifactId);
    delete artifactIndex[artifactId];
    delete artifactMeta[artifactId];
  }

  function releaseUnreferencedArtifact(artifactId: string) {
    if (bindingsForArtifact(artifactId).length > 0) return;
    removeArtifact(artifactId);
  }

  /**
   * Replaces an artifact's segment catalog with one segment per given label
   * value. Voxels are untouched: this is a catalog operation.
   */
  function setArtifactSegments(
    artifactId: string,
    descriptors: LabelmapSegment[]
  ) {
    const meta = artifactMeta[artifactId];
    if (!meta) throw new Error('No such artifact');

    const segmentation = ensureSegmentationForImage(meta.parentImage);
    segmentsForArtifact(artifactId).forEach((segment) =>
      detachSegment(segmentation, segment.id)
    );

    const extent = fullExtent(artifactIndex[artifactId].getDimensions());
    descriptors.forEach((descriptor) => {
      const segment = createSegment(segmentation.id, {
        name: descriptor.name,
        color: [...descriptor.color] as RGBAColor,
      });
      segment.visible = descriptor.visible;
      segment.locked = descriptor.locked ?? false;
      segment.representations.labelmap = {
        artifactId,
        labelValue: descriptor.value,
        extent,
      };
    });

    return segmentsForArtifact(artifactId);
  }

  /** The single voxel-allocation point: no other operation creates storage. */
  function ensureLabelmapBinding(
    segmentationId: string,
    segmentId: string,
    preferredArtifactId?: string
  ) {
    const segment = getSegment(segmentationId, segmentId);
    if (segment.representations.labelmap)
      return segment.representations.labelmap;

    const segmentation = getSegmentation(segmentationId);
    const artifactId =
      preferredArtifactId ??
      listSegments(segmentation).find((other) => other.representations.labelmap)
        ?.representations.labelmap?.artifactId ??
      createArtifactForImage(segmentation.parentImageId);

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

    detachSegment(segmentation, segmentId);

    if (!binding) return;
    artifactIndex[binding.artifactId]?.replaceLabelValue(
      binding.labelValue,
      LABELMAP_BACKGROUND_VALUE
    );
    releaseUnreferencedArtifact(binding.artifactId);
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
    [...artifactsForImage(parentImageId)].forEach(removeArtifact);
    delete artifactOrderByParent[parentImageId];
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
        byArtifact[binding.artifactId].push({
          value: binding.labelValue,
          name: segment.name,
          color: [...segment.color] as RGBAColor,
          visible: segment.visible,
          locked: segment.locked,
        });
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

  // --- handle deletions --- //

  onImageDeleted((deleted) => {
    deleted.forEach((parentImageId) => {
      delete nextDefaultIndex[parentImageId];
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
    artifactOrderByParent,
    labelmapSegmentsByArtifact,
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
    artifactsForImage,
    getSegmentationForArtifact,
    segmentsForArtifact,
    findSegmentByLabelValue,
    registerArtifact,
    createArtifactForImage,
    updateArtifactMeta,
    setArtifactSegments,
    removeArtifact,
    pickUniqueArtifactName,
  };
});
