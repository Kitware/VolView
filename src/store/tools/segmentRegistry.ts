import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';

import {
  STROKE_WIDTH_ANNOTATION_TOOL_DEFAULT,
  TOOL_COLORS,
} from '@/src/config';
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
  // Returns the label's id after the update: renaming a template moves its id,
  // and the annotations that named the old one have to follow it.
  updateLabel: (id: string, patch: Label<Props>) => string;
  deleteLabel: (id: string) => void;
  mergeLabel: (label: Label<Props>) => string;
  mergeLabels: (labels: Maybe<Labels<Props>>) => void;
  findLabel: (name: Maybe<string>) => [string, Label<Props>] | undefined;
  clearDefaultLabels: () => void;
  mergeLabelForImage: (imageId: Maybe<string>, label: Label<Props>) => string;
  // The segment a label id stands for on an image, minting one for a template
  // that has none there yet. Any other id is handed back untouched.
  materializeLabelForImage: (
    imageId: Maybe<string>,
    labelId: Maybe<string>
  ) => Maybe<string>;
  serializeIdentity: () => ToolWireIdentity<Props>;
  adoptIdentity: (
    serialized: Maybe<ToolWireIdentity<Props>>,
    segmentIdMap: Record<string, string>
  ) => (labelId: Maybe<string>) => string;
};

/**
 * The identity half of a tool's manifest entry: a shared registry's segments
 * already serialize on their segmentation, so only their per-tool props go on
 * the wire; a local registry still carries its whole label record. Config
 * templates have no segment to ride on, so a tool labeled with one would
 * restore unlabeled unless they travel too.
 */
export type ToolWireIdentity<Props> = {
  labels?: Labels<Props>;
  segmentProps?: Labels<Props>;
  templates?: Labels<Props>;
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

  const findSegment = (segmentId: string) =>
    segmentationStore.segmentExists(segmentId)
      ? segmentationStore.getSegment(segmentId)
      : undefined;

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

  // Config labels are declared once for the session, before any image loads.
  // They stay templates: nothing is minted until an edit materializes one, so
  // the picker offers the viewed image's segments followed by the templates
  // that image does not have yet.
  const sessionLabels = ref<Labels<Props>>({}) as Ref<Labels<Props>>;

  const TEMPLATE_ID_PREFIX = 'config-label:';
  const templateId = (name: string) => `${TEMPLATE_ID_PREFIX}${name}`;
  const templateNameOf = (id: string) =>
    id.startsWith(TEMPLATE_ID_PREFIX)
      ? id.slice(TEMPLATE_ID_PREFIX.length)
      : undefined;

  const toTemplateLabel = (name: string, props: ToolLabel) =>
    ({
      ...annotationToolLabelDefault,
      ...newLabelDefault,
      color: TOOL_COLORS[0],
      ...props,
      labelName: name,
    }) as ToolLabel;

  const templateLabels = computed(
    () =>
      Object.fromEntries(
        Object.entries(sessionLabels.value).map(([name, props]) => [
          templateId(name),
          toTemplateLabel(name, props),
        ])
      ) as Labels<Props>
  );

  const pendingTemplateNames = computed(() => {
    const taken = new Set(currentSegments.value.map((segment) => segment.name));
    return Object.keys(sessionLabels.value).filter((name) => !taken.has(name));
  });

  const labels = computed(
    () =>
      ({
        ...toLabelRecord(currentSegments.value),
        ...Object.fromEntries(
          pendingTemplateNames.value.map((name) => [
            templateId(name),
            templateLabels.value[templateId(name)],
          ])
        ),
      }) as Labels<Props>
  );

  // Templates included: a tool placed against one points at its template id, so
  // resolving that id has to keep working after the template's name is taken on
  // some image and the picker stops offering it.
  const allLabels = computed(
    () =>
      ({
        ...toLabelRecord(
          Object.values(segmentationStore.segmentations).flatMap(listSegments)
        ),
        ...templateLabels.value,
      }) as Labels<Props>
  );

  // Scoped to the viewed image: a segment belonging to another image must not
  // label an annotation placed here, or the annotation references a segment its
  // own image's segmentation does not hold.
  const activeSegmentId = computed(() => {
    const segmentId = segmentationStore.activeSegmentId;
    if (!segmentId) return undefined;
    return currentSegmentation.value?.segments[segmentId]
      ? segmentId
      : undefined;
  });

  // Derived, never mirrored: the store drops the template from the intent when
  // an edit materializes it, so the picker cannot go on reporting one selected.
  const activeTemplateName = computed(
    () => segmentationStore.activeSegmentIntent?.template?.name
  );

  const activeTemplateId = computed(() => {
    const name = activeTemplateName.value;
    if (!name) return undefined;
    return pendingTemplateNames.value.includes(name)
      ? templateId(name)
      : undefined;
  });

  const setActiveLabel = (id: string | undefined) => {
    const templateName = id ? templateNameOf(id) : undefined;
    const template = templateName
      ? sessionLabels.value[templateName]
      : undefined;
    if (templateName && template) {
      segmentationStore.setActiveSegmentTemplate({
        name: templateName,
        color: cssColorToRGBA(toTemplateLabel(templateName, template).color!),
      });
      return;
    }

    if (!id || !segmentationStore.segmentExists(id)) {
      segmentationStore.clearActiveSegment();
      return;
    }
    segmentationStore.setActiveSegment(id);
  };

  const activeLabel = computed({
    get: () => activeSegmentId.value ?? activeTemplateId.value,
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

  // Per-tool props belong to this tool store, so the segmentation store cannot
  // carry them across: they follow onto whatever an edit mints for the intent,
  // from the declared template first and from the origin segment on every
  // later cross-image clone.
  watch(
    () => segmentationStore.mintedSegment,
    (minted) => {
      if (!minted) return;
      const declared = minted.templateName
        ? sessionLabels.value[minted.templateName]
        : undefined;
      if (declared) {
        setProps(minted.segmentId, splitLabel(declared).props);
        return;
      }
      const inherited = minted.fromSegmentId
        ? propsBySegment.value[minted.fromSegmentId]
        : undefined;
      if (inherited) setProps(minted.segmentId, inherited);
    },
    { flush: 'sync' }
  );

  const addLabelForImage = (imageId: Maybe<string>, label: ToolLabel) => {
    if (!imageId) return '';
    const segmentation = segmentationStore.ensureSegmentationForImage(imageId);
    const { identity, props } = splitLabel(label);
    const segment = segmentationStore.createSegment(segmentation.id, identity);
    setProps(segment.id, props);
    return segment.id;
  };

  // A segment the caller wants right now. The picker's create path declares a
  // template instead, see addLabel.
  const createSegmentNow = (label: ToolLabel = {} as ToolLabel) => {
    const id = addLabelForImage(currentImageID.value, label);
    if (id) setActiveLabel(id);
    return id;
  };

  // Adding a label declares a template, the same road config labels take. It
  // has no segment to write into until an edit materializes it.
  const addLabel = (label: ToolLabel = {} as ToolLabel) => {
    const { labelName, ...props } = label;
    if (!labelName) return '';
    sessionLabels.value = {
      ...sessionLabels.value,
      [labelName]: props as Props,
    };
    const id = templateId(labelName);
    setActiveLabel(id);
    return id;
  };

  // Editing a template edits the template: it has no segment to write into
  // until an edit materializes it.
  const updateTemplate = (name: string, patch: ToolLabel) => {
    const { labelName, ...rest } = patch;
    const renamed = labelName ?? name;
    const { [name]: existing, ...others } = sessionLabels.value;
    sessionLabels.value = {
      ...others,
      [renamed]: { ...existing, ...rest },
    } as Labels<Props>;
    if (activeTemplateName.value === name) setActiveLabel(templateId(renamed));
    return templateId(renamed);
  };

  const updateLabel = (id: string, patch: ToolLabel) => {
    const templateName = templateNameOf(id);
    if (templateName && sessionLabels.value[templateName]) {
      return updateTemplate(templateName, patch);
    }
    if (!segmentationStore.segmentExists(id))
      throw new Error('Label does not exist');

    const { identity, props } = splitLabel(patch);
    segmentationStore.updateSegment(id, identity);
    setProps(id, props);
    return id;
  };

  const deleteLabel = (id: string) => {
    const templateName = templateNameOf(id);
    if (templateName && sessionLabels.value[templateName]) {
      sessionLabels.value = omit(sessionLabels.value, templateName);
      if (activeTemplateName.value === templateName) setActiveLabel('');
      return;
    }
    if (!segmentationStore.segmentExists(id))
      throw new Error('Label does not exist');

    // Read before deleting: the store drops the active segment with it.
    const wasActive = id === activeLabel.value;
    segmentationStore.deleteSegment(id);
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

  // An annotation placed against a template carries the template's id until an
  // edit materializes it. That edit lands in the identity the annotation names,
  // whatever the picker has selected by then.
  const materializeLabelForImage = (
    imageId: Maybe<string>,
    labelId: Maybe<string>
  ) => {
    const templateName = labelId ? templateNameOf(labelId) : undefined;
    const template = templateName
      ? sessionLabels.value[templateName]
      : undefined;
    if (!imageId || !templateName || !template) return labelId;

    const existing = findLabelForImage(imageId, templateName);
    if (existing) return existing[0];
    return addLabelForImage(imageId, toTemplateLabel(templateName, template));
  };

  // Declaring config labels neither mints segments nor takes over the
  // selection: they join the template pool the picker offers.
  const mergeLabels = (newLabels: Maybe<Labels<Props>>) => {
    const entries = Object.entries(newLabels ?? {});
    if (entries.length === 0) return;
    sessionLabels.value = {
      ...sessionLabels.value,
      ...Object.fromEntries(entries),
    } as Labels<Props>;
  };

  // Loading a second config replaces the first config's labels rather than
  // adding to them. Segments a template already became are left alone; only
  // the templates still unmaterialized go.
  const clearDefaultLabels = () => {
    const active = activeTemplateName.value;
    // An intent pointing at a discarded template would still mint that label on
    // the next edit, with the picker showing nothing selected.
    if (active && sessionLabels.value[active])
      segmentationStore.clearActiveSegment();
    sessionLabels.value = {} as Labels<Props>;
  };

  // The segments themselves restore with their segmentation; only the props
  // this tool store owns are re-attached, keyed by the restored segment id.
  // Templates have no segment, so they restore whole.
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

    // The saved scene's templates win over the session's: restoring reproduces
    // the scene that was saved.
    sessionLabels.value = {
      ...sessionLabels.value,
      ...serialized?.templates,
    } as Labels<Props>;

    // A template keeps its own id across the round trip: it names a session
    // label, not a segment, so there is nothing to remap it to. A segment the
    // restore did not recreate is a deleted one; leave the tool unlabeled.
    return (labelId: Maybe<string>) => {
      if (!labelId) return '';
      const templateName = templateNameOf(labelId);
      if (templateName) return sessionLabels.value[templateName] ? labelId : '';
      return segmentIdMap[labelId] || '';
    };
  };

  // Props outlive the tools that reference them: a label customized before any
  // annotation is placed still belongs to a live segment.
  const serializeIdentity = () => ({
    segmentProps: Object.fromEntries(
      Object.entries(propsBySegment.value).filter(([id]) => !!findSegment(id))
    ) as Labels<Props>,
    templates: sessionLabels.value,
  });

  return {
    segments,
    activeSegmentId,
    getSegment,
    setActiveSegment: (id: Maybe<string>) => setActiveLabel(id ?? undefined),
    createSegment: (init?: { name?: string; color?: string }) =>
      createSegmentNow({
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
    materializeLabelForImage,
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
    // A local label's id is minted, so an update never moves it.
    updateLabel: (id: string, patch: ToolLabel) => {
      labels.updateLabel(id, patch);
      return id;
    },
    mergeLabelForImage: (_imageId: Maybe<string>, label: ToolLabel) =>
      labels.mergeLabel(label),
    // Local labels are the tool store's own, so there is no template to mint.
    materializeLabelForImage: (
      _imageId: Maybe<string>,
      labelId: Maybe<string>
    ) => labelId,
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
