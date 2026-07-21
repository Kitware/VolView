// ---------------------------------------------------------------------------
// Spec-driven form model — the task description.
//
// Turns a validated task-spec envelope into the render model for the parameter
// form. Each parameter is validated INDIVIDUALLY against the contract's
// `taskParameterSchema`:
//   * a param that validates becomes a renderable `field` (a `VolViewTask
//     Parameter` — the engine renders straight from the spec type);
//   * a param that does NOT validate (unknown `kind`, or a self-inconsistent
//     constraint set) is HIDDEN and, if it was `required`, BLOCKS submit with
//     an inline reason. This is the fail-closed rule: the engine never silently
//     renders a param it cannot type, and never submits omitting a required one.
//
// Value handling is spec-driven too: typed defaults seed the initial values,
// and submit is gated on required-ness plus numeric min/max. `sourceRef` values
// are minted from provenance; `bounds` values are bound from the
// crop tool by the caller. This module stays pure (no store, no Vue).
//
// House rules: functional style; `type`, not `interface`.
// ---------------------------------------------------------------------------

import { taskParameterSchema } from '@/backend-contract';
import type { VolViewTaskParameter } from '@/backend-contract';
import type { ProcessingValue } from '@/src/processing/types';
import type { TaskSpecEnvelope } from './taskSpec';

// A renderable field is exactly a validated spec parameter.
export type FormField = VolViewTaskParameter;

// A parameter the engine refused to render (unknown kind / invalid constraints).
export type HiddenField = {
  id: string;
  required: boolean;
  reason: string;
};

export type TaskFormModel = {
  id: string;
  title: string;
  description?: string;
  // Renderable params, spec `order` first (stable for equal/absent order).
  fields: FormField[];
  // Params hidden by the fail-closed rule.
  hidden: HiddenField[];
};

export type FormValidationIssue = {
  parameter: string;
  message: string;
};

const asRecord = (raw: unknown): Record<string, unknown> =>
  raw !== null && typeof raw === 'object'
    ? (raw as Record<string, unknown>)
    : {};

const firstIssue = (error: { issues: { message: string }[] }): string =>
  error.issues[0]?.message ?? 'unsupported parameter';

export const fieldLabel = (f: FormField): string => f.title ?? f.id;

const isEmpty = (v: ProcessingValue | undefined): boolean =>
  v === null ||
  v === undefined ||
  (typeof v === 'string' && v.length === 0) ||
  (Array.isArray(v) && v.length === 0);

// Stable order: params with an explicit `order` sort ascending; params without
// keep their spec position (relative to each other and after ordered ones).
const byOrder = (
  a: FormField,
  b: FormField,
  ia: number,
  ib: number
): number => {
  const oa = a.order ?? Number.POSITIVE_INFINITY;
  const ob = b.order ?? Number.POSITIVE_INFINITY;
  return oa === ob ? ia - ib : oa - ob;
};

// ---------------------------------------------------------------------------
// Model construction
// ---------------------------------------------------------------------------

export const buildTaskFormModel = (env: TaskSpecEnvelope): TaskFormModel => {
  const fields: FormField[] = [];
  const hidden: HiddenField[] = [];

  env.parameters.forEach((raw) => {
    const parsed = taskParameterSchema.safeParse(raw);
    if (parsed.success) {
      fields.push(parsed.data);
      return;
    }
    // Fail closed: keep enough of the raw param to explain the omission and to
    // decide whether it blocks submit, but do NOT render it.
    const rec = asRecord(raw);
    hidden.push({
      id: typeof rec.id === 'string' ? rec.id : '(unnamed)',
      required: rec.required === true,
      reason: firstIssue(parsed.error),
    });
  });

  const sorted = fields
    .map((f, i) => [f, i] as const)
    .sort(([a, ia], [b, ib]) => byOrder(a, b, ia, ib))
    .map(([f]) => f);

  return {
    id: env.id,
    title: env.title,
    description: env.description,
    fields: sorted,
    hidden,
  };
};

// Hidden params that were required — the ones that must block submit.
export const blockingHiddenFields = (model: TaskFormModel): HiddenField[] =>
  model.hidden.filter((h) => h.required);

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

// Seed initial values from typed spec defaults. `sourceRef` is left unbound
// (its value is minted from provenance); `bounds` is left unbound
// unless the spec carries a default (the caller binds it from the crop tool).
export const initialFormValues = (
  model: TaskFormModel
): Record<string, ProcessingValue> => {
  const values: Record<string, ProcessingValue> = {};
  model.fields.forEach((f) => {
    switch (f.kind) {
      // Typed default seeds the value, or `null` when the spec omits one.
      case 'int':
      case 'float':
      case 'string':
      case 'bounds':
        values[f.id] = f.default ?? null;
        break;
      case 'bool':
        values[f.id] = f.default ?? false;
        break;
      case 'enum':
        values[f.id] = f.default ?? f.options[0] ?? null;
        break;
      case 'sourceRef':
        // Value is minted from provenance; rendered unbound here.
        values[f.id] = null;
        break;
      // No default: the switch is exhaustive over the contract's known kinds.
    }
  });
  return values;
};

// Gate submit. Returns the inline reasons a submit is refused; an empty array
// means the form is submittable.
export const validateFormValues = (
  model: TaskFormModel,
  values: Record<string, ProcessingValue>
): FormValidationIssue[] => {
  const issues: FormValidationIssue[] = [];

  // Fail closed on any required param the engine had to hide.
  blockingHiddenFields(model).forEach((h) => {
    issues.push({
      parameter: h.id,
      message: `"${h.id}" is required but uses an unsupported parameter type (${h.reason}) — cannot submit`,
    });
  });

  model.fields.forEach((f) => {
    const v = values[f.id];
    if (f.required && isEmpty(v)) {
      issues.push({
        parameter: f.id,
        message: `${fieldLabel(f)} is required`,
      });
      return;
    }
    if ((f.kind === 'int' || f.kind === 'float') && typeof v === 'number') {
      if (f.min != null && v < f.min) {
        issues.push({
          parameter: f.id,
          message: `${fieldLabel(f)} must be ≥ ${f.min}`,
        });
      }
      if (f.max != null && v > f.max) {
        issues.push({
          parameter: f.id,
          message: `${fieldLabel(f)} must be ≤ ${f.max}`,
        });
      }
    }
  });

  return issues;
};
