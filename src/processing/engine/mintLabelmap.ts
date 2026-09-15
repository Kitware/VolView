import type { InputValue } from '@/backend-contract';
import { TYPE_TAG_LABELMAP } from '@/backend-contract';
import type {
  FormValidationIssue,
  TaskFormModel,
} from '@/src/processing/engine/formModel';
import type {
  SourceRefBindingState,
  SourceRefField,
} from '@/src/processing/engine/mintInput';
import {
  ambiguousBinding,
  sourceRefFields,
  unboundBinding,
} from '@/src/processing/engine/mintInput';

export const labelmapInputFields = (model: TaskFormModel): SourceRefField[] =>
  sourceRefFields(model, TYPE_TAG_LABELMAP);

export type LabelmapBindingResult = {
  segmentations: Record<string, { segmentationId: string; multiple: boolean }>;
  states: Record<string, SourceRefBindingState>;
  // Caller must suppress its generic issue for these param ids.
  issues: FormValidationIssue[];
};

const EMPTY_BINDING: LabelmapBindingResult = {
  segmentations: {},
  states: {},
  issues: [],
};

const bindLabelmapFields = (
  fields: SourceRefField[],
  segmentationId: string | undefined,
  referenceAvailable: boolean
): LabelmapBindingResult => {
  if (fields.length === 0) return EMPTY_BINDING;

  if (fields.length > 1) {
    return { segmentations: {}, ...ambiguousBinding(fields, 'segmentation') };
  }

  const [field] = fields;

  if (!segmentationId) {
    return {
      segmentations: {},
      ...unboundBinding(field, 'no-segmentation', 'segmentation'),
    };
  }

  if (!referenceAvailable) {
    return {
      segmentations: {},
      ...unboundBinding(field, 'no-provenance', 'segmentation', true),
    };
  }

  return {
    segmentations: {
      [field.id]: { segmentationId, multiple: field.multiple === true },
    },
    states: { [field.id]: 'bound' },
    issues: [],
  };
};

export const bindLabelmapInputs = (
  model: TaskFormModel,
  segmentationId: string | undefined,
  referenceAvailable: boolean
): LabelmapBindingResult =>
  bindLabelmapFields(
    labelmapInputFields(model),
    segmentationId,
    referenceAvailable
  );

// `format` is omitted: the staged uri already carries the extension.
export const mintLabelmapValue = (uris: string[]): InputValue => ({
  type: TYPE_TAG_LABELMAP,
  uris,
});
