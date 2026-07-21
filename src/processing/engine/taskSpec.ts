import { z } from 'zod';
import { taskSpecSchema } from '@/backend-contract';

// Parameters stay raw so one unknown parameter kind hides a single param instead of rejecting the whole spec.
export const taskSpecEnvelopeSchema = taskSpecSchema
  .omit({ parameters: true })
  .extend({ parameters: z.array(z.unknown()) });

export type TaskSpecEnvelope = z.infer<typeof taskSpecEnvelopeSchema>;

export const parseTaskSpecEnvelope = (raw: unknown): TaskSpecEnvelope =>
  taskSpecEnvelopeSchema.parse(raw);
