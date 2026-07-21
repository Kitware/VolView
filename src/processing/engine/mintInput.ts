// ---------------------------------------------------------------------------
// Input minting, CLIENT half.
//
// The client authors the bound input value from the volume's OWN DataSource
// provenance. A volume loaded from the server carries its verbatim launch-
// manifest URIs up its provenance chain; those URIs — never a backend-advertised
// source, never a re-parsed string — are what we push back at submit: the
// client pushes back the grouped refs it already holds; the backend is a pure
// courier. A volume with NO URI provenance (local file drop, archive member,
// restored state file) bottoms out in a File/stateID, has no URIs, and is
// therefore NOT bindable: we fail closed (inline message + refuse submit) rather
// than silently uploading it.
//
//   * `type` is a SEMANTIC tag (open vocab) — this binder mints `image` only.
//   * `format` is an ADVISORY byte-format hint derived from provenance; it is
//     never load-bearing (the CLI re-sorts DICOM by metadata regardless), so we
//     do not sink effort into guaranteeing it.
//
// This module is PURE (no store, no Vue): the caller resolves the active
// volume's DataSource and hands it in.
//
// House rules: functional style; `type`, not `interface`.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Provenance → URIs (verbatim)
// ---------------------------------------------------------------------------

// Collect a volume's verbatim provenance URIs in constituent (slice) order. A
// DICOM volume is a `collection` of per-file sources, each of which walks up its
// parent chain to a `uri`; a single remote file walks straight up to its `uri`.
// A branch with no `uri` ancestor (local File / archive / state file)
// contributes nothing, so an EMPTY result means "no URI provenance". For a
// collection, EVERY constituent must resolve: a mixed-provenance volume (some
// remote chunks, some local/archive/state chunks) yields [] rather than a
// PARTIAL uri set the backend would process as an incomplete volume. The URI is
// round-tripped byte-for-byte — the client never parses or constructs it.
export const collectProvenanceUris = (ds: DataSource | undefined): string[] => {
  if (!ds) return [];
  if (ds.type === 'collection') {
    const perSource = ds.sources.map(collectProvenanceUris);
    return perSource.every((uris) => uris.length > 0) ? perSource.flat() : [];
  }
  if (ds.type === 'uri') return [ds.uri];
  return collectProvenanceUris(ds.parent);
};

// ---------------------------------------------------------------------------
// Advisory format hint
// ---------------------------------------------------------------------------

// The trailing filename extension, lower-cased and without the dot, or
// undefined when there is none. Compound extensions collapse to the last
// segment (`scan.nrrd` → `nrrd`); that is fine — `format` is advisory.
const lastExtension = (name: string | undefined): string | undefined => {
  if (!name) return undefined;
  const base = basename(name);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : undefined;
};

// Advisory only (format is advisory): a DICOM volume (a collection of
// DICOM chunks) → `dicom-series`; a single file → its trailing extension.
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

// ---------------------------------------------------------------------------
// Mint the input value
// ---------------------------------------------------------------------------

// Mint `{ type, format?, uris }` from a volume's provenance, or `null` when the
// volume has no URI provenance and is therefore not bindable (fail closed).
export const mintInputValue = (
  ds: DataSource | undefined,
  type: string = TYPE_TAG_IMAGE
): InputValue | null => {
  const uris = collectProvenanceUris(ds);
  if (uris.length === 0) return null;
  const format = ds ? deriveFormat(ds) : undefined;
  return format ? { type, format, uris } : { type, uris };
};

// ---------------------------------------------------------------------------
// Auto-bind the background image input to the active dataset
// ---------------------------------------------------------------------------

// Per-`sourceRef`-widget display state. Only `bound` is a success; the rest are
// fail-closed states the widget surfaces inline and the submit gate refuses on.
// Shared by the `image` binder (this module) and the `labelmap` binder
// (`mintLabelmap.ts`); `no-segment-group` is the labelmap-only fail-closed leaf.
export type SourceRefBindingState =
  | 'bound'
  | 'unbound' // no active dataset yet
  | 'no-provenance' // active volume has no server URIs → not bindable
  | 'no-segment-group' // labelmap input with no bindable segment group
  | 'ambiguous'; // more than one image/labelmap input → no v1 picker

type ImageSourceRefField = Extract<FormField, { kind: 'sourceRef' }>;

// The renderable `sourceRef` params that accept an `image` input. This binder
// handles `image` only; a `labelmap`-only input is the labelmap binder's
// concern and is left alone.
export const imageInputFields = (model: TaskFormModel): ImageSourceRefField[] =>
  model.fields.filter(
    (f): f is ImageSourceRefField =>
      f.kind === 'sourceRef' && f.accepts.includes(TYPE_TAG_IMAGE)
  );

export type ImageBindingResult = {
  // Minted values to merge into the form values (the bound image input).
  values: Record<string, ProcessingValue>;
  // Per-param widget state, keyed by param id.
  states: Record<string, SourceRefBindingState>;
  // Submit-blocking issues (fail closed). Owns the image params' gating fully,
  // so the caller suppresses any generic duplicate for these param ids.
  issues: FormValidationIssue[];
};

const EMPTY_BINDING: ImageBindingResult = {
  values: {},
  states: {},
  issues: [],
};

// Auto-bind the sole `image` sourceRef param to the active dataset. No
// picker in v1: zero image params is a no-op; more than one fails closed. The
// bound value is minted from the active volume's own provenance; a volume with
// no URI provenance fails closed with an inline reason. This function owns
// the image params' submit gating entirely (required-ness included).
export const bindImageInputs = (
  model: TaskFormModel,
  activeDataSource: DataSource | undefined
): ImageBindingResult => {
  const fields = imageInputFields(model);

  // Nothing to bind — other params gate themselves.
  if (fields.length === 0) return EMPTY_BINDING;

  // The binder AUTHORS every field it owns on every rebind — a fail-closed
  // branch writes an explicit `null`, never `{}`. Merging `{}` would leave the
  // PREVIOUS image's minted URI in the form values, so switching to an
  // unbindable image could submit the old image (worst for an OPTIONAL input,
  // where no issue blocks the submit).
  const nullValues = () =>
    Object.fromEntries(fields.map((f) => [f.id, null as ProcessingValue]));

  // Fail closed: v1 binds exactly one image input (the active dataset). More
  // than one needs a picker we do not ship — refuse rather than guess.
  if (fields.length > 1) {
    const states = Object.fromEntries(
      fields.map((f) => [f.id, 'ambiguous' as const])
    );
    return {
      values: nullValues(),
      states,
      issues: [
        {
          parameter: fields[0].id,
          message:
            'This task needs more than one image input, which this version cannot bind automatically.',
        },
      ],
    };
  }

  const [field] = fields;

  // No active dataset: unbound (explicitly null) and defer to the required
  // check.
  if (!activeDataSource) {
    return {
      values: nullValues(),
      states: { [field.id]: 'unbound' },
      issues: field.required
        ? [{ parameter: field.id, message: `${fieldLabel(field)} is required` }]
        : [],
    };
  }

  const value = mintInputValue(activeDataSource, TYPE_TAG_IMAGE);

  // Fail closed: the active volume has no server URIs, so it is not bindable —
  // regardless of required-ness (the user has a volume selected; it simply
  // cannot be used as input).
  if (!value) {
    return {
      values: nullValues(),
      states: { [field.id]: 'no-provenance' },
      issues: [
        {
          parameter: field.id,
          message:
            'The active volume was not loaded from the server, so it cannot be used as an input.',
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
