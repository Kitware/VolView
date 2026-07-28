// Bind all finished tools on the active image as one annotations file. The
// image must have server provenance and be declared as a separate task input so
// adopted-job reconstruction can recover it later.

import type { InputValue } from '@/backend-contract';
import { TYPE_TAG_ANNOTATIONS } from '@/backend-contract';
import type { FormValidationIssue, TaskFormModel } from './formModel';
import type { SourceRefBindingState, SourceRefField } from './mintInput';
import { ambiguousBinding, sourceRefFields, unboundBinding } from './mintInput';

export const annotationsInputFields = (
  model: TaskFormModel
): SourceRefField[] => sourceRefFields(model, TYPE_TAG_ANNOTATIONS);

export type AnnotationsBindingResult = {
  // Parameter ids the caller must stage an annotations file for.
  parameters: string[];
  states: Record<string, SourceRefBindingState>;
  // Caller must suppress its generic issue for these param ids.
  issues: FormValidationIssue[];
};

const EMPTY_BINDING: AnnotationsBindingResult = Object.freeze({
  parameters: [],
  states: {},
  issues: [],
});

const unbound = (
  field: SourceRefField,
  state: 'no-annotations' | 'no-provenance' | 'no-reference-input',
  // A selected volume that cannot be an input blocks regardless of
  // required-ness; anything else only blocks a required field.
  alwaysBlocks = false
): AnnotationsBindingResult => ({
  parameters: [],
  ...unboundBinding(field, state, 'annotation', alwaysBlocks),
});

export const bindAnnotationsInputs = (
  model: TaskFormModel,
  hasFinishedTools: boolean,
  referenceAvailable: boolean,
  declaresReferenceImage: boolean
): AnnotationsBindingResult => {
  const fields = annotationsInputFields(model);
  if (fields.length === 0) return EMPTY_BINDING;

  // More than one annotations input needs a picker that does not exist.
  if (fields.length > 1) {
    return { parameters: [], ...ambiguousBinding(fields, 'annotation') };
  }

  const [field] = fields;

  // Checked before the scene states: a task-shape defect cannot be fixed by
  // placing tools, so its message must not be masked by theirs. It still leaves
  // an optional field submittable — the task simply runs without annotations.
  if (!declaresReferenceImage) return unbound(field, 'no-reference-input');
  if (!hasFinishedTools) return unbound(field, 'no-annotations');
  if (!referenceAvailable) return unbound(field, 'no-provenance', true);

  return {
    parameters: [field.id],
    states: { [field.id]: 'bound' },
    issues: [],
  };
};

// `format` is omitted: the staged uri already carries the extension.
export const mintAnnotationsValue = (uris: string[]): InputValue => ({
  type: TYPE_TAG_ANNOTATIONS,
  uris,
});
