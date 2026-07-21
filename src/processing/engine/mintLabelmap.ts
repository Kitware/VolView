import type { InputValue } from '@/backend-contract';
import { TYPE_TAG_LABELMAP } from '@/backend-contract';
import type { DataSource } from '@/src/io/import/dataSource';
import type { FormValidationIssue, TaskFormModel } from './formModel';
import type { SourceRefBindingState, SourceRefField } from './mintInput';
import {
  ambiguousBinding,
  bindingStateMessage,
  mintInputValue,
  sourceRefFields,
} from './mintInput';

export const labelmapInputFields = (model: TaskFormModel): SourceRefField[] =>
  sourceRefFields(model, TYPE_TAG_LABELMAP);

// Passed in rather than read from the store so resolution stays pure.
export type SegmentGroupView = {
  orderByParent: Record<string, string[] | undefined>;
  metadataByID: Record<string, { parentImage: string } | undefined>;
};

export const mintLabelmapReferenceImage = (
  segmentGroupId: string,
  view: SegmentGroupView,
  getDataSource: (imageId: string) => DataSource | undefined
): InputValue | null => {
  const parentImage = view.metadataByID[segmentGroupId]?.parentImage;
  return parentImage ? mintInputValue(getDataSource(parentImage)) : null;
};

export type LabelmapResolution =
  | { kind: 'resolved'; groupId: string }
  | { kind: 'unresolved' };

export const resolveLabelmapGroup = (
  backgroundImageId: string | undefined,
  activeSegmentGroupId: string | null | undefined,
  view: SegmentGroupView
): LabelmapResolution => {
  if (!backgroundImageId) return { kind: 'unresolved' };

  const belongsToBackground = (groupId: string): boolean =>
    view.metadataByID[groupId]?.parentImage === backgroundImageId;

  if (activeSegmentGroupId && belongsToBackground(activeSegmentGroupId)) {
    return { kind: 'resolved', groupId: activeSegmentGroupId };
  }

  // No picker exists, so an ambiguous background fails closed.
  const groups = view.orderByParent[backgroundImageId] ?? [];
  if (groups.length === 1 && belongsToBackground(groups[0])) {
    return { kind: 'resolved', groupId: groups[0] };
  }

  return { kind: 'unresolved' };
};

export type LabelmapBindingResult = {
  groups: Record<string, string>;
  states: Record<string, SourceRefBindingState>;
  // Caller must suppress its generic issue for these param ids.
  issues: FormValidationIssue[];
};

const EMPTY_BINDING: LabelmapBindingResult = {
  groups: {},
  states: {},
  issues: [],
};

const bindLabelmapFields = (
  fields: SourceRefField[],
  resolution: LabelmapResolution
): LabelmapBindingResult => {
  if (fields.length === 0) return EMPTY_BINDING;

  if (fields.length > 1) {
    return { groups: {}, ...ambiguousBinding(fields, 'segment group') };
  }

  const [field] = fields;

  if (resolution.kind === 'unresolved') {
    return {
      groups: {},
      states: { [field.id]: 'no-segment-group' },
      issues: field.required
        ? [
            {
              parameter: field.id,
              message: bindingStateMessage(
                'no-segment-group',
                'segment group'
              )!,
            },
          ]
        : [],
    };
  }

  return {
    groups: { [field.id]: resolution.groupId },
    states: { [field.id]: 'bound' },
    issues: [],
  };
};

export const bindResolvedLabelmapInputs = (
  model: TaskFormModel,
  resolution: LabelmapResolution
): LabelmapBindingResult =>
  bindLabelmapFields(labelmapInputFields(model), resolution);

export const bindLabelmapInputs = (
  model: TaskFormModel,
  backgroundImageId: string | undefined,
  activeSegmentGroupId: string | null | undefined,
  view: SegmentGroupView
): LabelmapBindingResult => {
  const fields = labelmapInputFields(model);
  const resolution =
    fields.length === 1
      ? resolveLabelmapGroup(backgroundImageId, activeSegmentGroupId, view)
      : { kind: 'unresolved' as const };
  return bindLabelmapFields(fields, resolution);
};

// `format` is omitted: the staged uri already carries the extension.
export const mintLabelmapValue = (uris: string[]): InputValue => ({
  type: TYPE_TAG_LABELMAP,
  uris,
});
