import type { DataSource } from '@/src/io/import/dataSource';
import { getDataSourceName } from '@/src/io/import/dataSource';
import { FILE_EXT_TO_MIME } from '@/src/io/mimeTypes';
import { basename } from '@/src/utils/path';
import type { InputValue } from '@/backend-contract';
import { TYPE_TAG_IMAGE } from '@/backend-contract';
import type { ProcessingValue } from '@/src/processing/types';
import type {
  FormField,
  FormValidationIssue,
  TaskFormModel,
} from './formModel';
import { fieldLabel } from './formModel';

// A partial uri set would be processed as an incomplete volume.
export const collectProvenanceUris = (ds: DataSource | undefined): string[] => {
  if (!ds) return [];
  if (ds.type === 'collection') {
    const perSource = ds.sources.map(collectProvenanceUris);
    return perSource.every((uris) => uris.length > 0) ? perSource.flat() : [];
  }
  if (ds.type === 'uri') return [ds.uri];
  return collectProvenanceUris(ds.parent);
};

// Compound extensions collapse to the last segment, which is fine because
// `format` is only an advisory hint.
const lastExtension = (name: string | undefined): string | undefined => {
  if (!name) return undefined;
  const base = basename(name);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : undefined;
};

export const deriveFormat = (ds: DataSource): string | undefined => {
  if (ds.type === 'collection') {
    const isDicom = ds.sources.some(
      (s) => s.type === 'chunk' && s.mime === FILE_EXT_TO_MIME.dcm
    );
    return isDicom ? 'dicom-series' : undefined;
  }
  return (
    lastExtension(getDataSourceName(ds) ?? undefined) ??
    lastExtension(collectProvenanceUris(ds)[0])
  );
};

export const mintInputValue = (
  ds: DataSource | undefined,
  type: string = TYPE_TAG_IMAGE
): InputValue | null => {
  const uris = collectProvenanceUris(ds);
  if (uris.length === 0) return null;
  const format = ds ? deriveFormat(ds) : undefined;
  return format ? { type, format, uris } : { type, uris };
};

export type SourceRefBindingState =
  | 'bound'
  | 'unbound'
  | 'no-provenance'
  | 'no-segment-group'
  | 'ambiguous';

export type SourceRefField = Extract<FormField, { kind: 'sourceRef' }>;

export const sourceRefFields = (
  model: TaskFormModel,
  typeTag: string
): SourceRefField[] =>
  model.fields.filter(
    (f): f is SourceRefField =>
      f.kind === 'sourceRef' && f.accepts.includes(typeTag)
  );

export const imageInputFields = (model: TaskFormModel): SourceRefField[] =>
  sourceRefFields(model, TYPE_TAG_IMAGE);

// One source for the user-facing binding sentences: the binders emit them as
// validation issues and FileWidget renders the same text in the form body.
export const bindingStateMessage = (
  state: SourceRefBindingState,
  noun: 'image' | 'segment group'
): string | undefined => {
  if (state === 'no-provenance')
    return 'The active volume was not loaded from the server, so it cannot be used as an input.';
  if (state === 'no-segment-group')
    return 'Paint or select a segment group first.';
  if (state === 'ambiguous')
    return `This task needs more than one ${noun} input, which this version cannot bind automatically.`;
  return undefined;
};

// More than one input of a kind needs a picker that does not exist, so refuse
// rather than guess.
export const ambiguousBinding = (
  fields: SourceRefField[],
  noun: 'image' | 'segment group'
): {
  states: Record<string, SourceRefBindingState>;
  issues: FormValidationIssue[];
} => ({
  states: Object.fromEntries(fields.map((f) => [f.id, 'ambiguous' as const])),
  issues: [
    {
      parameter: fields[0].id,
      message: bindingStateMessage('ambiguous', noun)!,
    },
  ],
});

export type ImageBindingResult = {
  values: Record<string, ProcessingValue>;
  states: Record<string, SourceRefBindingState>;
  // Caller suppresses generic duplicates for these param ids.
  issues: FormValidationIssue[];
};

const EMPTY_BINDING: ImageBindingResult = {
  values: {},
  states: {},
  issues: [],
};

const bindImageFields = (
  fields: SourceRefField[],
  activeDataSource: DataSource | undefined,
  value: InputValue | null
): ImageBindingResult => {
  if (fields.length === 0) return EMPTY_BINDING;

  // Explicit null, not `{}`: a stale merge could submit the previous image.
  const nullValues = () =>
    Object.fromEntries(fields.map((f) => [f.id, null as ProcessingValue]));

  if (fields.length > 1) {
    return { values: nullValues(), ...ambiguousBinding(fields, 'image') };
  }

  const [field] = fields;

  if (!activeDataSource) {
    return {
      values: nullValues(),
      states: { [field.id]: 'unbound' },
      issues: field.required
        ? [{ parameter: field.id, message: `${fieldLabel(field)} is required` }]
        : [],
    };
  }

  // Blocks regardless of required-ness: a volume is selected, it just cannot be
  // used as input.
  if (!value) {
    return {
      values: nullValues(),
      states: { [field.id]: 'no-provenance' },
      issues: [
        {
          parameter: field.id,
          message: bindingStateMessage('no-provenance', 'image')!,
        },
      ],
    };
  }

  return {
    values: { [field.id]: value },
    states: { [field.id]: 'bound' },
    issues: [],
  };
};

export const bindMintedImageInputs = (
  model: TaskFormModel,
  activeDataSource: DataSource | undefined,
  value: InputValue | null
): ImageBindingResult =>
  bindImageFields(imageInputFields(model), activeDataSource, value);

export const bindImageInputs = (
  model: TaskFormModel,
  activeDataSource: DataSource | undefined
): ImageBindingResult => {
  const fields = imageInputFields(model);
  const value =
    fields.length === 1 && activeDataSource
      ? mintInputValue(activeDataSource, TYPE_TAG_IMAGE)
      : null;
  return bindImageFields(fields, activeDataSource, value);
};
