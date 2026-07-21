// ---------------------------------------------------------------------------
// Task-spec envelope validation — the task description.
//
// The engine fetches the SERVER-EMITTED, zod-validated VolView task spec and
// renders the parameter form from it — it parses no XML and knows no backend
// format. It consumes the published `backend-contract` package verbatim; it
// never re-derives or re-shapes that schema.
//
// One subtlety drives this module. The whole-spec `taskSpecSchema` is a
// discriminated union over `kind`, so it HARD-rejects a spec that carries an
// unknown parameter kind. But the engine must fail
// closed PER PARAMETER (hide the one bad param, refuse submit only if it was
// required) — not reject the whole form (task-spec.ts, lines 52-57). So the
// engine validates the ENVELOPE here (spec header + outputs, parameters kept
// raw) and validates each parameter individually in `formModel.ts`.
//
// House rules: functional style; `type`, not `interface`.
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { taskSpecSchema } from '@/backend-contract';

// Reuse the contract's own spec object, swapping only `parameters` for a raw
// pass-through array. Everything else (specVersion / id / title / outputs) is
// validated exactly as the contract defines it — the envelope is a projection
// of the published schema, not a competing copy of it.
export const taskSpecEnvelopeSchema = taskSpecSchema
  .omit({ parameters: true })
  .extend({ parameters: z.array(z.unknown()) });

export type TaskSpecEnvelope = z.infer<typeof taskSpecEnvelopeSchema>;

// Validate a fetched task spec at the envelope level. Throws (via zod) when the
// spec header itself is malformed — a spec we cannot even frame is not
// renderable. Per-parameter validity is decided later, per param.
export const parseTaskSpecEnvelope = (raw: unknown): TaskSpecEnvelope =>
  taskSpecEnvelopeSchema.parse(raw);
