import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';

import { STROKE_WIDTH_ANNOTATION_TOOL_DEFAULT } from '@/src/config';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useSegmentationStore } from '@/src/store/segmentations';
import type { Maybe } from '@/src/types';
import type { Segment } from '@/src/types/segmentation';
import { omit } from '@/src/utils';
import {
  cssColorToRGBA,
  listSegments,
  rgbaToCssColor,
} from '@/src/types/segmentation';
import { useLabels, type Label, type Labels } from './useLabels';

export type RegistrySegment = {
  id: string;
  name: string;
  color: string; // CSS color for tool rendering
};

export type SegmentRegistry = {
  segments: ComputedRef<RegistrySegment[]>;
  activeSegmentId: ComputedRef<Maybe<string>>;
  getSegment: (id: string) => Maybe<RegistrySegment>;
  setActiveSegment: (id: Maybe<string>) => void;
  createSegment: (init?: { name?: string; color?: string }) => string;
};

/**
 * The label-record surface label pickers, the config importer and the wire
 * shims still read off a tool store. Identity in it is a projection of the
 * registry's segments; only the per-tool props are the tool store's own.
 */
export type SegmentLabelApi<Props> = {
  labels: Ref<Labels<Props>>;
  // Every segment a tool may point at, including tools on other images.
  allLabels: Ref<Labels<Props>>;
  activeLabel: Ref<string | undefined>;
  setActiveLabel: (id: string | undefined) => void;
  addLabel: (label?: Label<Props>) => string;
  updateLabel: (id: string, patch: Label<Props>) => void;
  deleteLabel: (id: string) => void;
  mergeLabel: (label: Label<Props>) => string;
  mergeLabels: (labels: Maybe<Labels<Props>>) => void;
  findLabel: (name: Maybe<string>) => [string, Label<Props>] | undefined;
  clearDefaultLabels: () => void;
  mergeLabelForImage: (imageId: Maybe<string>, label: Label<Props>) => string;
  serializeIdentity: () => ToolWireIdentity<Props>;
  adoptIdentity: (
    serialized: Maybe<ToolWireIdentity<Props>>,
    segmentIdMap: Record<string, string>
  ) => (labelId: Maybe<string>) => string;
};

/**
 * The identity half of a tool's manifest entry: a shared registry's segments
 * already serialize on their segmentation, so only their per-tool props go on
 * the wire; a local registry still carries its whole label record.
 */
export type ToolWireIdentity<Props> = {
  labels?: Labels<Props>;
  segmentProps?: Labels<Props>;
};

export type ToolSegmentRegistry<Props> = SegmentRegistry &
  SegmentLabelApi<Props>;

const annotationToolLabelDefault = Object.freeze({
  strokeWidth: STROKE_WIDTH_ANNOTATION_TOOL_DEFAULT as number,
});

const toRegistrySegment = (segment: Segment) => ({
  id: segment.id,
  name: segment.name,
  color: rgbaToCssColor(segment.color),
});

/** Identity from the segmentation store, scoped to the viewed image. */
export const createSharedSegmentRegistry = <Props extends object = object>(
  newLabelDefault?: Props
): ToolSegmentRegistry<Props> => {
  const segmentationStore = useSegmentationStore();
  const { currentImageID } = useCurrentImage('global');

  type ToolLabel = Label<Props>;

  // Per-tool props stay with the tool store; the segment carries identity only.
  const propsBySegment = ref<Record<string, ToolLabel>>({}) as Ref<
    Record<string, ToolLabel>
  >;

  const segmentationFor = (imageId: Maybe<string>) =>
    imageId ? segmentationStore.getSegmentationForImage(imageId) : undefined;

  const currentSegmentation = computed(() =>
    segmentationFor(currentImageID.value)
  );

  const currentSegments = computed(() => {
    const segmentation = currentSegmentation.value;
    return segmentation ? listSegments(segmentation) : [];
  });

  const segments = computed(() => currentSegments.value.map(toRegistrySegment));

  const owningSegmentation = (segmentId: string) =>
    Object.values(segmentationStore.segmentations).find(
      (segmentation) => segmentId in segmentation.segments
    );

  const findSegment = (segmentId: string) =>
    owningSegmentation(segmentId)?.segments[segmentId];

  const getSegment = (id: string) => {
    const segment = findSegment(id);
    return segment ? toRegistrySegment(segment) : undefined;
  };

  const toLabel = (segment: Segment) =>
    ({
      ...annotationToolLabelDefault,
      ...newLabelDefault,
      ...propsBySegment.value[segment.id],
      labelName: segment.name,
      color: rgbaToCssColor(segment.color),
    }) as ToolLabel;

  const toLabelRecord = (list: Segment[]) =>
    Object.fromEntries(
      list.map((segment) => [segment.id, toLabel(segment)])
    ) as Labels<Props>;

  const labels = computed(() => toLabelRecord(currentSegments.value));

  const allLabels = computed(() =>
    toLabelRecord(
      Object.values(segmentationStore.segmentations).flatMap(listSegments)
    )
  );

  // Scoped to the viewed image: a segment belonging to another image must not
  // label an annotation placed here, or the annotation references a segment its
  // own image's segmentation does not hold.
  const activeSegmentId = computed(() => {
    const target = segmentationStore.activeTarget;
    if (!target || !currentImageID.value) return undefined;
    const segmentation = segmentationStore.getSegmentationForImage(
      currentImageID.value
    );
    return segmentation?.id === target.segmentationId
      ? target.segmentId
      : undefined;
  });

  const setActiveLabel = (id: string | undefined) => {
    const segmentation = id ? owningSegmentation(id) : undefined;
    if (!id || !segmentation) {
      segmentationStore.clearActiveSegment();
      return;
    }
    segmentationStore.setActiveSegment(segmentation.id, id);
  };

  const activeLabel = computed({
    get: () => activeSegmentId.value ?? undefined,
    set: setActiveLabel,
  });

  const setProps = (segmentId: string, props: ToolLabel) => {
    propsBySegment.value = {
      ...propsBySegment.value,
      [segmentId]: { ...propsBySegment.value[segmentId], ...props },
    };
  };

  const splitLabel = (label: ToolLabel) => {
    const { labelName, color, ...props } = label;
    return {
      identity: {
        ...(labelName === undefined ? {} : { name: labelName }),
        ...(color === undefined ? {} : { color: cssColorToRGBA(color) }),
      },
      props: props as ToolLabel,
    };
  };

  const addLabelForImage = (imageId: Maybe<string>, label: ToolLabel) => {
    if (!imageId) return '';
    const segmentation = segmentationStore.ensureSegmentationForImage(imageId);
    const { identity, props } = splitLabel(label);
    const segment = segmentationStore.createSegment(segmentation.id, identity);
    setProps(segment.id, props);
    return segment.id;
  };

  const addLabel = (label: ToolLabel = {} as ToolLabel) => {
    const id = addLabelForImage(currentImageID.value, label);
    if (id) setActiveLabel(id);
    return id;
  };

  const updateLabel = (id: string, patch: ToolLabel) => {
    const segmentation = owningSegmentation(id);
    if (!segmentation) throw new Error('Label does not exist');

    const { identity, props } = splitLabel(patch);
    segmentationStore.updateSegment(segmentation.id, id, identity);
    setProps(id, props);
  };

  const deleteLabel = (id: string) => {
    const segmentation = owningSegmentation(id);
    if (!segmentation) throw new Error('Label does not exist');

    // Read before deleting: the store drops the active target with the segment.
    const wasActive = id === activeLabel.value;
    segmentationStore.deleteSegment(segmentation.id, id);
    propsBySegment.value = omit(propsBySegment.value, id);

    if (wasActive) {
      setActiveLabel(segments.value[0]?.id ?? '');
    }
  };

  const findLabelForImage = (imageId: Maybe<string>, name: Maybe<string>) => {
    const segmentation = segmentationFor(imageId);
    if (!segmentation) return undefined;
    const segment = listSegments(segmentation).find(
      (candidate) => candidate.name === name
    );
    return segment
      ? ([segment.id, toLabel(segment)] as [string, ToolLabel])
      : undefined;
  };

  const findLabel = (name: Maybe<string>) =>
    findLabelForImage(currentImageID.value, name);

  const mergeLabelForImage = (imageId: Maybe<string>, label: ToolLabel) => {
    const existing = findLabelForImage(imageId, label.labelName);
    if (existing) {
      updateLabel(existing[0], label);
      return existing[0];
    }
    const id = addLabelForImage(imageId, label);
    if (id) setActiveLabel(id);
    return id;
  };

  const mergeLabel = (label: ToolLabel) =>
    mergeLabelForImage(currentImageID.value, label);

  // Config labels are declared once for the session, but segments live per
  // image and config lands before any image loads, so they are held here and
  // seeded into each image's segmentation as that image becomes current.
  let sessionLabels: Labels<Props> = {};
  const seededImages = new Set<string>();

  const seedSessionLabels = (imageId: string) => {
    const entries = Object.entries(sessionLabels);
    if (entries.length === 0 || seededImages.has(imageId)) return;
    seededImages.add(imageId);
    entries.forEach(([labelName, props]) =>
      mergeLabelForImage(imageId, { ...props, labelName } as ToolLabel)
    );
  };

  const mergeLabels = (newLabels: Maybe<Labels<Props>>) => {
    const entries = Object.entries(newLabels ?? {});
    if (entries.length === 0) return;

    sessionLabels = { ...sessionLabels, ...Object.fromEntries(entries) };
    seededImages.clear();
    if (currentImageID.value) seedSessionLabels(currentImageID.value);
  };

  watch(currentImageID, (imageId) => {
    if (imageId) seedSessionLabels(imageId);
  });

  // Segments are never seeded, so there is nothing default to clear.
  const clearDefaultLabels = () => {};

  // The segments themselves restore with their segmentation; only the props
  // this tool store owns are re-attached, keyed by the restored segment id.
  const adoptIdentity = (
    serialized: Maybe<ToolWireIdentity<Props>>,
    segmentIdMap: Record<string, string>
  ) => {
    // One assignment, not one per entry: setProps clones the whole record each
    // time, which is quadratic in the number of restored segments.
    const merged = { ...propsBySegment.value };
    Object.entries(serialized?.segmentProps ?? {}).forEach(
      ([wireId, props]) => {
        const segmentId = segmentIdMap[wireId];
        if (segmentId) {
          merged[segmentId] = { ...merged[segmentId], ...(props as ToolLabel) };
        }
      }
    );
    propsBySegment.value = merged;
    // A segment the restore did not recreate is a deleted one; leave the tool
    // unlabeled.
    return (labelId: Maybe<string>) => (labelId && segmentIdMap[labelId]) || '';
  };

  // Props outlive the tools that reference them: a label customized before any
  // annotation is placed still belongs to a live segment.
  const serializeIdentity = () => ({
    segmentProps: Object.fromEntries(
      Object.entries(propsBySegment.value).filter(([id]) => !!findSegment(id))
    ) as Labels<Props>,
  });

  return {
    segments,
    activeSegmentId,
    getSegment,
    setActiveSegment: (id: Maybe<string>) => setActiveLabel(id ?? undefined),
    createSegment: (init?: { name?: string; color?: string }) =>
      addLabel({
        ...(init?.name === undefined ? {} : { labelName: init.name }),
        ...(init?.color === undefined ? {} : { color: init.color }),
      } as ToolLabel),
    labels,
    allLabels,
    activeLabel,
    setActiveLabel,
    addLabel,
    updateLabel,
    deleteLabel,
    mergeLabel,
    mergeLabels,
    findLabel,
    clearDefaultLabels,
    mergeLabelForImage,
    serializeIdentity,
    adoptIdentity,
  };
};

/** Identity owned by the tool store itself, as rulers have always had it. */
export const createLocalSegmentRegistry = <Props extends object = object>(
  initialLabels: Labels<Props>,
  newLabelDefault?: Props
): ToolSegmentRegistry<Props> => {
  type ToolLabel = Label<Props>;

  const labels = useLabels<Props>({
    ...annotationToolLabelDefault,
    ...newLabelDefault,
  } as Props);
  labels.mergeLabels(initialLabels);

  const toSegment = (id: string, label: ToolLabel) => ({
    id,
    name: label.labelName ?? '',
    color: label.color ?? '',
  });

  const getSegment = (id: string) => {
    const label = labels.labels.value[id];
    return label ? toSegment(id, label) : undefined;
  };

  return {
    segments: computed(() =>
      Object.entries(labels.labels.value).map(([id, label]) =>
        toSegment(id, label)
      )
    ),
    activeSegmentId: computed(() => labels.activeLabel.value),
    getSegment,
    setActiveSegment: (id: Maybe<string>) =>
      labels.setActiveLabel(id ?? undefined),
    createSegment: (init?: { name?: string; color?: string }) =>
      labels.addLabel({
        ...(init?.name === undefined ? {} : { labelName: init.name }),
        ...(init?.color === undefined ? {} : { color: init.color }),
      } as ToolLabel),
    ...labels,
    allLabels: labels.labels,
    mergeLabelForImage: (_imageId: Maybe<string>, label: ToolLabel) =>
      labels.mergeLabel(label),
    adoptIdentity: (serialized: Maybe<ToolWireIdentity<Props>>) => {
      const serializedLabels = serialized?.labels;
      if (!serializedLabels) return () => '';
      labels.clearDefaultLabels();
      const idMap = Object.fromEntries(
        Object.entries(serializedLabels).map(([id, label]) => [
          id,
          labels.addLabel(label as ToolLabel), // side effect in Array.map
        ])
      );
      return (labelId: Maybe<string>) => (labelId && idMap[labelId]) || '';
    },
    serializeIdentity: () => ({ labels: labels.labels.value }),
  };
};
