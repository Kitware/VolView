// ---------------------------------------------------------------------------
// Runtime egress origin gate.
//
// Same-origin predicate for configured egress targets, enforced at each call
// site: processing-provider baseUrl/jobsBaseUrl (processing/config.ts) and the
// remote-save target (store/remote-save-state.ts). A URL is allowed iff its
// origin is SAME-ORIGIN as the deployment (its own server, deployment-
// controlled by definition — zero config). This keeps a crafted config or
// `?save=` link from pointing job submissions or the session zip at a
// third-party origin.
//
// The gate covers EGRESS only. Data loading (`urls=`) is deliberately not
// gated: reading public cross-origin datasets — IDC S3, TCIA GCS buckets — is
// a supported flow, and reading third-party data is not the risk that sending
// the user's session to a third party is.
//
// Bearer headers remain ungated: $fetch attaches global headers regardless of
// origin, which is what the documented `token=` cross-origin data flow relies
// on.
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
