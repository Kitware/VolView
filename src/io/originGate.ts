// ---------------------------------------------------------------------------
// Runtime egress origin gate.
//
// Same-origin predicate for configured processing-provider targets, enforced
// at their call site (processing/config.ts). A URL is allowed iff its origin
// is SAME-ORIGIN as the deployment (its own server, deployment-controlled by
// definition — zero config). This keeps a crafted config from pointing job
// submissions at a third-party origin.
//
// Remote-save (`save=`) targets and bearer headers are intentionally NOT
// gated: any save target is accepted and $fetch attaches global headers
// regardless of origin.
// ---------------------------------------------------------------------------

import { parseUrl } from '@/src/utils/url';

// Resolve any egress URL (possibly relative) to its origin. A relative URL
// resolves against the current document, i.e. same-origin.
export const resolveOrigin = (url: string): string | null => {
  try {
    return parseUrl(url, window.location.href).origin;
  } catch {
    return null;
  }
};

/**
 * Returns `true` iff a configured target resolves to the deployment's own
 * origin. Processing-provider config loading enforces this predicate.
 */
export const isOriginAllowed = (url: string): boolean =>
  resolveOrigin(url) === window.location.origin;
