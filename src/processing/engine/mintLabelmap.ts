// ---------------------------------------------------------------------------
// Labelmap input binding, CLIENT half.
//
// The one input the client authors itself. A `labelmap` sourceRef param
// (`accepts: ["labelmap"]`, authored by the backend's Slicer-XML→spec
// translation — never inferred here) auto-binds to a painted SEGMENT GROUP.
// Unlike the background image, a segment group has NO server-URI provenance:
// it earns provenance at Run through a staging upload (serialize → POST →
// backend-minted `{uris}`), so this module does NOT mint from provenance. It
// only RESOLVES which segment group backs the input (the deterministic fallback
// chain + guard) and reports the fail-closed states; the impure serialize +
// stage + `{type:"labelmap", uris}` mint happens at submit (JobsModule).
//
// Fallback chain, deterministic, no picker:
//   (1) the paint-active group, IF its `parentImage` is the bound background;
//   (2) else the bound background's ONLY segment group;
//   (3) else FAIL CLOSED — "paint or select a segment group first".
// The `parentImage` guard applies to whichever group the chain selects: it must
// belong to the bound background (the active dataset). Multiple groups with none
// paint-active on this background stays fail-closed (the v2 picker is deferred).
//
// This module is PURE (no store, no Vue): the caller passes a plain read-only
// view of the segment-group store so the chain + guard stay unit-testable.
//
// House rules: functional style; `type`, not `interface`.
// ---------------------------------------------------------------------------

import type { InputValue } from '@/backend-contract';
import { TYPE_TAG_LABELMAP } from '@/backend-contract';
import type { DataSource } from '@/src/io/import/dataSource';
import type {
  FormField,
  FormValidationIssue,
  TaskFormModel,
} from './formModel';
import type { SourceRefBindingState } from './mintInput';
import { mintInputValue } from './mintInput';

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

type LabelmapSourceRefField = Extract<FormField, { kind: 'sourceRef' }>;

// The renderable `sourceRef` params that accept a `labelmap` input. The client
// binds purely by the open type tag off the zod-validated spec —
// it hardcodes no Slicer `<image type=...>` knowledge.
export const labelmapInputFields = (
  model: TaskFormModel
): LabelmapSourceRefField[] =>
  model.fields.filter(
    (f): f is LabelmapSourceRefField =>
      f.kind === 'sourceRef' && f.accepts.includes(TYPE_TAG_LABELMAP)
  );

// ---------------------------------------------------------------------------
// Segment-group resolution (the fallback chain + guard)
// ---------------------------------------------------------------------------

// The minimal read-only view of the segment-group store the resolver needs.
// Passed in (rather than reaching into Pinia) so the chain + guard are pure and
// unit-testable. Field names mirror the store: `orderByParent[imageId]` is the
// group ids for that parent image; `metadataByID[groupId].parentImage` is the
// guard field.
export type SegmentGroupView = {
  orderByParent: Record<string, string[] | undefined>;
  metadataByID: Record<string, { parentImage: string } | undefined>;
};

// Resolve the group-to-image relationship already carried by VolView and mint
// that image's ordinary opaque-provenance InputValue. This remains provider
// neutral: callers supply the DataSource lookup, and URI strings are copied
// byte-for-byte without interpretation.
export const mintLabelmapReferenceImage = (
  segmentGroupId: string,
  view: SegmentGroupView,
  getDataSource: (imageId: string) => DataSource | undefined
): InputValue | null => {
  const parentImage = view.metadataByID[segmentGroupId]?.parentImage;
  return parentImage ? mintInputValue(getDataSource(parentImage)) : null;
};

// Which segment group backs the labelmap input, or `unresolved` (fail closed).
export type LabelmapResolution =
  | { kind: 'resolved'; groupId: string }
  | { kind: 'unresolved' };

// Resolve the fallback chain against the bound background. The `parentImage`
// guard is applied to EVERY branch's candidate: a group whose parentImage is
// not the background is never usable — the chain continues, then fails closed.
export const resolveLabelmapGroup = (
  backgroundImageId: string | undefined,
  activeSegmentGroupId: string | null | undefined,
  view: SegmentGroupView
): LabelmapResolution => {
  if (!backgroundImageId) return { kind: 'unresolved' };

  const belongsToBackground = (groupId: string): boolean =>
    view.metadataByID[groupId]?.parentImage === backgroundImageId;

  // Branch 1: the paint-active group — usable only if the guard passes.
  if (activeSegmentGroupId && belongsToBackground(activeSegmentGroupId)) {
    return { kind: 'resolved', groupId: activeSegmentGroupId };
  }

  // Branch 2: the background's ONLY segment group. More than one (with none
  // paint-active on this background) stays fail-closed — no v1 picker.
  const groups = view.orderByParent[backgroundImageId] ?? [];
  if (groups.length === 1 && belongsToBackground(groups[0])) {
    return { kind: 'resolved', groupId: groups[0] };
  }

  // Branch 3: fail closed.
  return { kind: 'unresolved' };
};

// ---------------------------------------------------------------------------
// Bind the labelmap input
// ---------------------------------------------------------------------------

export type LabelmapBindingResult = {
  // The resolved segment-group id to serialize + stage at Run, keyed by param
  // id. Empty when unresolved (fail closed) — there is nothing to stage.
  groups: Record<string, string>;
  // Per-param widget state, keyed by param id.
  states: Record<string, SourceRefBindingState>;
  // Submit-blocking issues (fail closed). Owns the labelmap params' gating
  // fully, so the caller suppresses any generic duplicate for these param ids.
  issues: FormValidationIssue[];
};

const EMPTY_BINDING: LabelmapBindingResult = {
  groups: {},
  states: {},
  issues: [],
};

// Bind the sole `labelmap` sourceRef param to a resolved segment group. No
// picker in v1: zero labelmap params is a no-op; more than one fails closed
// (the contract's v1 multi-input shape is exactly one background + one
// labelmap). This function owns the labelmap params' submit gating entirely.
export const bindLabelmapInputs = (
  model: TaskFormModel,
  backgroundImageId: string | undefined,
  activeSegmentGroupId: string | null | undefined,
  view: SegmentGroupView
): LabelmapBindingResult => {
  const fields = labelmapInputFields(model);

  // Nothing to bind — other params gate themselves.
  if (fields.length === 0) return EMPTY_BINDING;

  // Fail closed: v1 binds exactly one labelmap input. More than one needs a
  // picker we do not ship — refuse rather than guess.
  if (fields.length > 1) {
    return {
      groups: {},
      states: Object.fromEntries(
        fields.map((f) => [f.id, 'ambiguous' as const])
      ),
      issues: [
        {
          parameter: fields[0].id,
          message:
            'This task needs more than one segment group input, which this version cannot bind automatically.',
        },
      ],
    };
  }

  const [field] = fields;
  const resolution = resolveLabelmapGroup(
    backgroundImageId,
    activeSegmentGroupId,
    view
  );

  // No bindable segment group for the bound background. Only BLOCK submit when
  // the input is required — an optional labelmap simply stays unbound, matching
  // the image binder (mintInput.ts) which also gates its unbound issue on
  // `field.required`.
  if (resolution.kind === 'unresolved') {
    return {
      groups: {},
      states: { [field.id]: 'no-segment-group' },
      issues: field.required
        ? [
            {
              parameter: field.id,
              message: 'Paint or select a segment group first.',
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

// ---------------------------------------------------------------------------
// Mint the labelmap value from the staging response
// ---------------------------------------------------------------------------

// The bound labelmap value is `{ type: "labelmap", uris }` — the uris come from
// the backend STAGING RESPONSE (backend-minted), never from DataSource
// provenance. `format` is intentionally omitted (advisory only): the
// staged file already carries its `.seg.nrrd` extension in the minted URI.
export const mintLabelmapValue = (uris: string[]): InputValue => ({
  type: TYPE_TAG_LABELMAP,
  uris,
});

// Narrow a form value to the labelmap `sourceRef` params so the caller can keep
// the async serialize/stage step tightly scoped.
export type LabelmapStageTarget = {
  parameterId: string;
  segmentGroupId: string;
};

// The (paramId, groupId) pairs to serialize + stage at Run, derived from a
// binding result. Empty when nothing resolved.
export const labelmapStageTargets = (
  binding: LabelmapBindingResult
): LabelmapStageTarget[] =>
  Object.entries(binding.groups).map(([parameterId, segmentGroupId]) => ({
    parameterId,
    segmentGroupId,
  }));
