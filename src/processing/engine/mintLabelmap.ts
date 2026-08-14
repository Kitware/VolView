import type { InputValue } from '@/backend-contract';
import { TYPE_TAG_LABELMAP } from '@/backend-contract';
import type { DataSource } from '@/src/io/import/dataSource';
import type { FormValidationIssue, TaskFormModel } from './formModel';
import type { SourceRefBindingState, SourceRefField } from './mintInput';
import {
  ambiguousBinding,
  mintInputValue,
  sourceRefFields,
  unboundBinding,
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
  | { kind: 'resolved'; groupIds: string[] }
  | { kind: 'unresolved' };

export const resolveLabelmapGroups = (
  backgroundImageId: string | undefined,
  activeSegmentGroupId: string | null | undefined,
  multiple: boolean,
  view: SegmentGroupView
): LabelmapResolution => {
  if (!backgroundImageId) return { kind: 'unresolved' };

  const groupIds = (view.orderByParent[backgroundImageId] ?? []).filter(
    (groupId) => view.metadataByID[groupId]?.parentImage === backgroundImageId
  );
  if (multiple) {
    return groupIds.length > 0
      ? { kind: 'resolved', groupIds }
      : { kind: 'unresolved' };
  }
  if (activeSegmentGroupId && groupIds.includes(activeSegmentGroupId)) {
    return { kind: 'resolved', groupIds: [activeSegmentGroupId] };
  }
  return groupIds.length === 1
    ? { kind: 'resolved', groupIds }
    : { kind: 'unresolved' };
};

export type LabelmapBindingResult = {
  groups: Record<string, string[]>;
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
      ...unboundBinding(field, 'no-segment-group', 'segment group'),
    };
  }

  return {
    groups: { [field.id]: resolution.groupIds },
    states: { [field.id]: 'bound' },
    issues: [],
  };
};

export const bindResolvedLabelmapInputs = (
  model: TaskFormModel,
  resolution: LabelmapResolution
): LabelmapBindingResult =>
  bindLabelmapFields(labelmapInputFields(model), resolution);

// `format` is omitted: the staged uri already carries the extension.
export const mintLabelmapValue = (uris: string[]): InputValue => ({
  type: TYPE_TAG_LABELMAP,
  uris,
});
