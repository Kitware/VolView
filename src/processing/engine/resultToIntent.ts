// ---------------------------------------------------------------------------
// Resolve a wire result to a declarative result intent.
//
// The producer (backend) now emits the neutral `intent` vocabulary natively, so
// the client consumes it directly — there is NO `role` switch here anymore (the
// closed `role` enum is retired: never a closed role enum).
// The single applier maps the resolved intent to store calls.
//
// A missing or unknown intent, or a known-name payload whose shape is invalid,
// carries no VolView state directive. The result remains an ordinary backend
// result record. The gate is the
// STRICT `knownResultIntentSchema` member — a name-known-but-shape-invalid
// result must not be applied as if it were a valid segment group.
//
// Lives in the engine/core home; core imports it (`actions/processResults`).
// ---------------------------------------------------------------------------

import {
  knownResultIntentSchema,
  type KnownResultIntent,
} from '@/backend-contract';
import type { ProcessingResult } from '@/src/processing/types';

export const resultToIntent = (
  result: ProcessingResult
): KnownResultIntent | undefined => {
  // The whole result row is the candidate: `id`/`name`/`url` are now required
  // schema fields (a missing id itself fails the gate), and each strict member
  // keeps only what it declares plus passthrough extras (so `segments`/`source`
  // survive only on `add-segment-group`) while rejecting an unknown or malformed
  // shape.
  const known = knownResultIntentSchema.safeParse(result);
  return known.success ? known.data : undefined;
};
