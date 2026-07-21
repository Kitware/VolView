import { z } from 'zod';
import {
  reportDuplicateTaskSpecIds,
  SPEC_VERSION,
  taskSpecStructuralSchema,
} from '@/backend-contract';

// Parameters stay raw so one unknown parameter kind hides a single param instead of rejecting the whole spec.
export const taskSpecEnvelopeSchema = taskSpecStructuralSchema
  .omit({ specVersion: true, parameters: true })
  .extend({
    specVersion: z.literal(SPEC_VERSION),
    parameters: z.array(z.unknown()),
  })
  .superRefine(reportDuplicateTaskSpecIds);

export type TaskSpecEnvelope = z.infer<typeof taskSpecEnvelopeSchema>;

export const parseTaskSpecEnvelope = (raw: unknown): TaskSpecEnvelope =>
  taskSpecEnvelopeSchema.parse(raw);
