// ---------------------------------------------------------------------------
// Runtime egress origin gate.
//
// Shared same-origin predicate for the configured processing-provider and
// remote-save targets. Enforcement remains at those targets' call sites. A URL
// is allowed iff its origin is SAME-ORIGIN as the deployment (its own server,
// deployment-controlled by definition — zero config).
//
// Every deployment serves VolView same-origin with its backend, so cross-origin
// egress is never permitted. This is what keeps a crafted config or a `save=`
// URL param from pointing egress (a session zip, a bearer token) at a
// third-party origin: the target must resolve to the deployment's own origin or
// it is refused.
// ---------------------------------------------------------------------------

// Resolve any egress URL (possibly relative) to its origin. A relative URL
// resolves against the current document, i.e. same-origin.
export const resolveOrigin = (url: string): string | null => {
  try {
    return new URL(url, window.location.href).origin;
  } catch {
    return null;
  }
};

/**
 * Returns `true` iff a configured target resolves to the deployment's own
 * origin. Processing-provider and remote-save callers enforce this predicate.
 */
export const isOriginAllowed = (url: string): boolean =>
  resolveOrigin(url) === window.location.origin;
