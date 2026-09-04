import { computed, ref, watch, type Ref } from 'vue';

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

/**
 * The label-record surface label pickers, the config importer and the wire
 * shims still read off a tool store. Identity in it is a projection of the
 * registry's segments; only the per-tool props are the tool store's own.
 */
export type ToolSegmentRegistry<Props> = {
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
  isLabelLocked: (id: string) => boolean;
  mergeLabel: (label: Label<Props>) => string;
  mergeLabels: (labels: Maybe<Labels<Props>>) => void;
  findLabel: (name: Maybe<string>) => [string, Label<Props>] | undefined;
  clearDefaultLabels: () => void;
  replaceConfigLabels: (labels: Maybe<Labels<Props>>) => void;
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

const annotationToolLabelDefault = Object.freeze({
  strokeWidth: STROKE_WIDTH_ANNOTATION_TOOL_DEFAULT as number,
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

  const findSegment = (segmentId: string) =>
    segmentationStore.segmentExists(segmentId)
      ? segmentationStore.getSegment(segmentId)
      : undefined;

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

  // Saved and user-created templates survive config replacement. Config
  // templates overlay matching names while their config is active.
  const sessionLabels = ref<Labels<Props>>({}) as Ref<Labels<Props>>;
  const configLabels = ref<Labels<Props>>({}) as Ref<Labels<Props>>;
  const effectiveTemplates = computed(
    () =>
      ({
        ...sessionLabels.value,
        ...configLabels.value,
      }) as Labels<Props>
  );

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
        Object.entries(effectiveTemplates.value).map(([name, props]) => [
          templateId(name),
          toTemplateLabel(name, props),
        ])
      ) as Labels<Props>
  );

  const pendingTemplateNames = computed(() => {
    const taken = new Set(currentSegments.value.map((segment) => segment.name));
    return Object.keys(effectiveTemplates.value).filter(
      (name) => !taken.has(name)
    );
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
      ? effectiveTemplates.value[templateName]
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
        ? effectiveTemplates.value[minted.templateName]
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

  // Restoring templates neither mints segments nor takes over the selection.
  const mergeLabels = (newLabels: Maybe<Labels<Props>>) => {
    const entries = Object.entries(newLabels ?? {});
    if (entries.length === 0) return;
    sessionLabels.value = {
      ...sessionLabels.value,
      ...Object.fromEntries(entries),
    } as Labels<Props>;
  };

  // A new label has no segment to write into until an edit materializes it.
  const addLabel = (label: ToolLabel = {} as ToolLabel) => {
    const { labelName, ...props } = label;
    if (!labelName) return '';
    mergeLabels({ [labelName]: props } as Labels<Props>);
    const id = templateId(labelName);
    setActiveLabel(id);
    return id;
  };

  // Editing a template edits the template: it has no segment to write into
  // until an edit materializes it.
  const updateTemplate = (name: string, patch: ToolLabel) => {
    const { labelName, ...rest } = patch;
    const renamed = labelName ?? name;
    const source = configLabels.value[name] ? configLabels : sessionLabels;
    const { [name]: existing, ...others } = source.value;
    source.value = {
      ...others,
      [renamed]: { ...existing, ...rest },
    } as Labels<Props>;
    if (activeTemplateName.value === name) setActiveLabel(templateId(renamed));
    return templateId(renamed);
  };

  const requireEditableSegment = (id: string, action: 'edit' | 'delete') => {
    if (!segmentationStore.segmentExists(id)) {
      throw new Error('Label does not exist');
    }
    if (segmentationStore.getSegment(id).locked) {
      throw new Error(`Cannot ${action} a locked segment`);
    }
  };

  const updateLabel = (id: string, patch: ToolLabel) => {
    const templateName = templateNameOf(id);
    if (templateName && effectiveTemplates.value[templateName]) {
      return updateTemplate(templateName, patch);
    }
    requireEditableSegment(id, 'edit');

    const { identity, props } = splitLabel(patch);
    segmentationStore.updateSegment(id, identity);
    setProps(id, props);
    return id;
  };

  const deleteTemplate = (id: string) => {
    const name = templateNameOf(id);
    if (!name || !effectiveTemplates.value[name]) return false;
    sessionLabels.value = omit(sessionLabels.value, name);
    configLabels.value = omit(configLabels.value, name);
    if (activeTemplateName.value === name) setActiveLabel('');
    return true;
  };

  const deleteLabel = (id: string) => {
    if (deleteTemplate(id)) return;
    requireEditableSegment(id, 'delete');

    // Read before deleting: the store drops the active segment with it.
    const wasActive = id === activeLabel.value;
    segmentationStore.deleteSegment(id);
    propsBySegment.value = omit(propsBySegment.value, id);

    if (wasActive) {
      setActiveLabel(currentSegments.value[0]?.id ?? '');
    }
  };

  const isLabelLocked = (id: string) => !!findSegment(id)?.locked;

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
      if (isLabelLocked(existing[0])) return existing[0];
      updateLabel(existing[0], label);
      return existing[0];
    }
    const id = addLabelForImage(imageId, label);
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
      ? effectiveTemplates.value[templateName]
      : undefined;
    if (!imageId || !templateName || !template) return labelId;

    const label = toTemplateLabel(templateName, template);
    const existing = findLabelForImage(imageId, templateName);
    const segmentId = existing?.[0] ?? addLabelForImage(imageId, label);
    segmentationStore.landActiveSegmentTemplate(segmentId, {
      name: templateName,
      color: cssColorToRGBA(label.color!),
    });
    return segmentId;
  };

  // Segments a config template already became are independent of the template.
  const clearDefaultLabels = () => {
    const active = activeTemplateName.value;
    // An intent pointing at a discarded template would still mint that label on
    // the next edit, with the picker showing nothing selected.
    if (active && configLabels.value[active])
      segmentationStore.clearActiveSegment();
    configLabels.value = {} as Labels<Props>;
  };

  const replaceConfigLabels = (configured: Maybe<Labels<Props>>) => {
    const active = activeTemplateName.value;
    configLabels.value = { ...(configured ?? {}) } as Labels<Props>;
    if (!active) return;

    const replacement = effectiveTemplates.value[active];
    if (!replacement) {
      segmentationStore.clearActiveSegment();
      return;
    }
    segmentationStore.setActiveSegmentTemplate({
      name: active,
      color: cssColorToRGBA(toTemplateLabel(active, replacement).color!),
    });
  };

  // The segments themselves restore with their segmentation; only the props
  // this tool store owns are re-attached, keyed by the restored segment id.
  // Templates have no segment, so they restore whole.
  const adoptIdentity = (
    serialized: Maybe<ToolWireIdentity<Props>>,
    segmentIdMap: Record<string, string>
  ) => {
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
      if (templateName)
        return effectiveTemplates.value[templateName] ? labelId : '';
      return segmentIdMap[labelId] || '';
    };
  };

  // Props outlive the tools that reference them: a label customized before any
  // annotation is placed still belongs to a live segment.
  const serializeIdentity = () => ({
    segmentProps: Object.fromEntries(
      Object.entries(propsBySegment.value).filter(([id]) => !!findSegment(id))
    ) as Labels<Props>,
    templates: effectiveTemplates.value,
  });

  return {
    labels,
    allLabels,
    activeLabel,
    setActiveLabel,
    addLabel,
    updateLabel,
    deleteLabel,
    isLabelLocked,
    mergeLabel,
    mergeLabels,
    findLabel,
    clearDefaultLabels,
    replaceConfigLabels,
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

  const configCreatedIds = new Map<string, string>();
  const labelsUnderConfig = new Map<string, ToolLabel>();

  const replaceConfigLabels = (configured: Maybe<Labels<Props>>) => {
    const activeBefore = labels.activeLabel.value;
    const next = { ...(configured ?? {}) } as Labels<Props>;

    labelsUnderConfig.forEach((label, id) => {
      if (labels.labels.value[id]) labels.replaceLabel(id, label);
    });
    labelsUnderConfig.clear();

    configCreatedIds.forEach((id, labelName) => {
      const props = next[labelName];
      if (!props || !labels.labels.value[id]) {
        if (labels.labels.value[id]) labels.deleteLabel(id);
        configCreatedIds.delete(labelName);
        return;
      }
      labels.replaceLabel(id, {
        ...annotationToolLabelDefault,
        ...newLabelDefault,
        ...props,
        labelName,
      } as ToolLabel);
    });

    labels.clearDefaultLabels();
    Object.entries(next).forEach(([labelName, props]) => {
      if (configCreatedIds.has(labelName)) return;
      const label = { ...props, labelName } as ToolLabel;
      const existing = labels.findLabel(labelName);
      if (existing) {
        const [id, previous] = existing;
        labelsUnderConfig.set(id, { ...previous });
        labels.updateLabel(id, label);
        return;
      }
      configCreatedIds.set(labelName, labels.mergeLabelWithoutSelection(label));
    });
    if (activeBefore && !labels.labels.value[activeBefore]) {
      labels.setActiveLabel(Object.keys(labels.labels.value)[0]);
    }
  };

  return {
    ...labels,
    allLabels: labels.labels,
    // A local label's id is minted, so an update never moves it.
    updateLabel: (id: string, patch: ToolLabel) => {
      labels.updateLabel(id, patch);
      return id;
    },
    isLabelLocked: () => false,
    replaceConfigLabels,
    mergeLabelForImage: (_imageId: Maybe<string>, label: ToolLabel) =>
      labels.mergeLabelWithoutSelection(label),
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
