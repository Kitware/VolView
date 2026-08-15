import type { InputValue, VolViewTaskParameter } from '@/backend-contract';
import { TYPE_TAG_ANNOTATIONS, TYPE_TAG_LABELMAP } from '@/backend-contract';
import type {
  ProcessingValue,
  SubmittedJobDisplay,
  SubmittedJobParameterDisplay,
} from '@/src/processing/types';
import { fieldLabel, type TaskFormModel } from './formModel';
import type { BoundSourceRefType } from './sourceRefs';

// Everything the display strings are made of, resolved by the caller in one
// synchronous pass so formatting stays pure.
export type JobDisplayContext = {
  // Parameter id → display names of the segment groups bound to it.
  labelmapNames: Record<string, string[]>;
  types: Record<string, BoundSourceRefType>;
  imageName: string | undefined;
  annotationCount: number;
};

const boundLabelmapName = (
  ctx: JobDisplayContext,
  parameterId: string
): string | undefined => {
  const names = ctx.labelmapNames[parameterId] ?? [];
  return names.length > 0 ? names.join(', ') : undefined;
};

// The bound value is a whole set of tools rather than one named resource, so
// the count is the identifying part.
const boundAnnotationsName = (ctx: JobDisplayContext): string => {
  const noun = ctx.annotationCount === 1 ? 'annotation' : 'annotations';
  const count = `${ctx.annotationCount} ${noun}`;
  return ctx.imageName ? `${count} on ${ctx.imageName}` : count;
};

const boundSourceRefName = (
  ctx: JobDisplayContext,
  parameterId: string
): string | undefined => {
  const type = ctx.types[parameterId];
  if (type === TYPE_TAG_LABELMAP) return boundLabelmapName(ctx, parameterId);
  if (type === TYPE_TAG_ANNOTATIONS) return boundAnnotationsName(ctx);
  return ctx.imageName;
};

export const buildSourceRefNames = (
  model: TaskFormModel,
  ctx: JobDisplayContext
): Record<string, string> => {
  const names: Record<string, string> = {};
  model.fields.forEach((field) => {
    if (field.kind !== 'sourceRef') return;
    const name = boundSourceRefName(ctx, field.id);
    if (name) names[field.id] = name;
  });
  return names;
};

export const formatProcessingValue = (
  ctx: JobDisplayContext,
  field: VolViewTaskParameter,
  value: ProcessingValue
): string => {
  if (field.kind === 'sourceRef') {
    // A bound labelmap param always names its groups, so the fallback is the
    // optional param that bound nothing.
    const fallback =
      ctx.types[field.id] === TYPE_TAG_LABELMAP
        ? 'not provided'
        : 'active dataset';
    return boundSourceRefName(ctx, field.id) ?? fallback;
  }
  if (field.kind === 'bounds') {
    return Array.isArray(value) && value.length > 0
      ? value.map((n) => (typeof n === 'number' ? n.toFixed(1) : n)).join(', ')
      : 'not set';
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return value.join(', ');
  if (value && typeof value === 'object') {
    const input = value as InputValue;
    return input.type;
  }
  if (value === null || value === undefined || value === '') return 'not set';
  return String(value);
};

const isSummaryParameter = (
  field: VolViewTaskParameter,
  value: ProcessingValue
): boolean => {
  if (field.kind === 'sourceRef' || field.kind === 'bounds') return false;
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
};

export const buildJobDisplay = (
  model: TaskFormModel,
  ctx: JobDisplayContext,
  values: Record<string, ProcessingValue>
): SubmittedJobDisplay => {
  let summaryCount = 0;
  const parameters: SubmittedJobParameterDisplay[] = model.fields.map(
    (field) => {
      const value = values[field.id];
      const summary = summaryCount < 2 && isSummaryParameter(field, value);
      if (summary) summaryCount += 1;
      return {
        id: field.id,
        label: fieldLabel(field),
        value: formatProcessingValue(ctx, field, value),
        ...(summary ? { summary } : {}),
      };
    }
  );
  const inputName = ctx.imageName;
  return {
    taskTitle: model.title,
    ...(inputName ? { inputName } : {}),
    parameters,
  };
};
