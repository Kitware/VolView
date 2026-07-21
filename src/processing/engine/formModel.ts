import { taskParameterSchema } from '@/backend-contract';
import type { VolViewTaskParameter } from '@/backend-contract';
import { isRecord } from '@/src/utils';
import type { ProcessingValue } from '@/src/processing/types';
import type { TaskSpecEnvelope } from './taskSpec';

export type FormField = VolViewTaskParameter;

export type HiddenField = {
  id: string;
  required: boolean;
  reason: string;
};

export type TaskFormModel = {
  id: string;
  title: string;
  description?: string;
  fields: FormField[];
  hidden: HiddenField[];
};

export type FormValidationIssue = {
  parameter: string;
  message: string;
};

const firstIssue = (error: { issues: { message: string }[] }): string =>
  error.issues[0]?.message ?? 'unsupported parameter';

export const fieldLabel = (f: FormField): string => f.title ?? f.id;

// A min+max float renders as a slider showing `value ?? min`. Single source
// of the predicate so seeded values stay in sync with what the widget paints.
export const sliderConfig = (f: FormField) =>
  f.kind === 'float' && f.min != null && f.max != null
    ? { min: f.min, max: f.max, step: f.step }
    : null;

export const isStepAligned = (
  value: number,
  step: number,
  base = 0
): boolean => {
  const offset = (value - base) / step;
  const tolerance = Number.EPSILON * 16 * Math.max(1, Math.abs(offset));
  return Math.abs(offset - Math.round(offset)) <= tolerance;
};

const isEmpty = (v: ProcessingValue | undefined): boolean =>
  v === null ||
  v === undefined ||
  (typeof v === 'string' && v.length === 0) ||
  (Array.isArray(v) && v.length === 0);

export const buildTaskFormModel = (env: TaskSpecEnvelope): TaskFormModel => {
  const fields: FormField[] = [];
  const hidden: HiddenField[] = [];

  env.parameters.forEach((raw) => {
    const parsed = taskParameterSchema.safeParse(raw);
    if (parsed.success) {
      fields.push(parsed.data);
      return;
    }
    const rec = isRecord(raw) ? raw : {};
    hidden.push({
      id: typeof rec.id === 'string' ? rec.id : '(unnamed)',
      required: rec.required === true,
      reason: firstIssue(parsed.error),
    });
  });

  // Array.prototype.sort is stable, so equal/missing orders keep spec order.
  const orderOf = (f: FormField) => f.order ?? Number.POSITIVE_INFINITY;
  const sorted = [...fields].sort((a, b) => {
    const oa = orderOf(a);
    const ob = orderOf(b);
    return oa === ob ? 0 : oa - ob;
  });

  return {
    id: env.id,
    title: env.title,
    description: env.description,
    fields: sorted,
    hidden,
  };
};

export const blockingHiddenFields = (model: TaskFormModel): HiddenField[] =>
  model.hidden.filter((h) => h.required);

export const initialFormValues = (
  model: TaskFormModel
): Record<string, ProcessingValue> => {
  const values: Record<string, ProcessingValue> = {};
  model.fields.forEach((f) => {
    switch (f.kind) {
      case 'float':
        values[f.id] = f.default ?? sliderConfig(f)?.min ?? null;
        break;
      case 'int':
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
        // Value is minted from provenance by the caller.
        values[f.id] = null;
        break;
    }
  });
  return values;
};

export const validateFormValues = (
  model: TaskFormModel,
  values: Record<string, ProcessingValue>
): FormValidationIssue[] => {
  const issues: FormValidationIssue[] = [];

  blockingHiddenFields(model).forEach((h) => {
    issues.push({
      parameter: h.id,
      message: `"${h.id}" is required but uses an unsupported parameter type (${h.reason}) — cannot submit`,
    });
  });

  model.fields.forEach((f) => {
    const v = values[f.id];
    // An enum member of '' counts as filled; the contract accepts it by membership.
    const isDeclaredOption =
      f.kind === 'enum' && f.options.some((o) => o === v);
    if (f.required && isEmpty(v) && !isDeclaredOption) {
      issues.push({
        parameter: f.id,
        message: `${fieldLabel(f)} is required`,
      });
      return;
    }
    if ((f.kind === 'int' || f.kind === 'float') && typeof v === 'number') {
      if (f.kind === 'int' && !Number.isInteger(v)) {
        issues.push({
          parameter: f.id,
          message: `${fieldLabel(f)} must be a whole number`,
        });
      }
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
      if (f.step != null && !isStepAligned(v, f.step, f.min ?? 0)) {
        const from = f.min != null ? ` from ${f.min}` : '';
        issues.push({
          parameter: f.id,
          message: `${fieldLabel(f)} must be in steps of ${f.step}${from}`,
        });
      }
    }
  });

  return issues;
};
