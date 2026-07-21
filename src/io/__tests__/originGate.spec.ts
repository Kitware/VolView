// Runtime egress origin gate. A target is allowed iff it resolves to the
// deployment's own origin; every cross-origin target is refused.

import { describe, expect, it } from 'vitest';
import { isOriginAllowed, resolveOrigin } from '@/src/io/originGate';

const sameOrigin = (path: string) => `${window.location.origin}${path}`;

describe('origin gate', () => {
  it('allows a same-origin absolute URL', () => {
    expect(isOriginAllowed(sameOrigin('/api/save'))).toBe(true);
  });

  it('allows a relative URL (resolves same-origin)', () => {
    expect(isOriginAllowed('/volview_processing')).toBe(true);
  });

  it('refuses a cross-origin URL', () => {
    expect(isOriginAllowed('https://attacker.example/exfil')).toBe(false);
  });

  it('refuses a cross-origin URL that differs only by scheme', () => {
    // window.location.origin is https in the test env; http is a distinct origin.
    expect(isOriginAllowed('http://analysis.example/api')).toBe(false);
  });

  it('refuses an unparseable URL', () => {
    // A scheme with no host throws in the URL parser ⇒ no origin ⇒ refused.
    expect(isOriginAllowed('http://')).toBe(false);
  });

  it('resolveOrigin normalizes relative and absolute URLs', () => {
    expect(resolveOrigin('/x')).toBe(window.location.origin);
    expect(resolveOrigin('https://h.example:8443/y')).toBe(
      'https://h.example:8443'
    );
    // A scheme with no host is unparseable ⇒ null.
    expect(resolveOrigin('http://')).toBeNull();
  });
});
