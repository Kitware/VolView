import { z } from 'zod';

// Opaque IDs used as URL path segments must not be dot segments. URL parsers
// normalize both literal and percent-encoded dot segments before dispatch.
export const pathSegmentIdSchema = z
  .string()
  .min(1)
  .regex(/^(?!\.{1,2}$)/, 'id must not be a dot segment');
