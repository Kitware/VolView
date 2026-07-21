// Config-by-shape recognition. A JSON is recognized as config
// purely by shape (no channel distinction). The trust boundary is strict on
// section VALUES but forward-compatible on unknown top-level KEYS: only known
// top-level section keys ⇒ config (ignoredKeys empty); a known key alongside
// unknown top-level keys ⇒ config with the unknown keys stripped and reported
// via `ignoredKeys` (a newer config on an older client still applies its known
// sections); no config signal ⇒ data.

import { describe, it, expect } from 'vitest';
import { recognizeConfig } from '@/src/io/import/configJson';

describe('config-by-shape recognition', () => {
  it('recognizes a JSON with only known top-level keys as config', async () => {
    const result = await recognizeConfig({
      windowing: { level: 40, width: 400 },
    });
    expect(result.kind).toBe('config');
    if (result.kind === 'config') {
      expect(result.config.windowing).toEqual({ level: 40, width: 400 });
      // No unknown keys to strip.
      expect(result.ignoredKeys).toEqual([]);
    }
  });

  it('recognizes a processing-only config (registration gated later by origin)', async () => {
    const result = await recognizeConfig({
      processing: {
        providers: [
          {
            id: 'p',
            label: 'Analysis',
            baseUrl: '/volview_processing',
            jobsBaseUrl: '/volview_processing',
          },
        ],
      },
    });
    expect(result.kind).toBe('config');
  });

  it('forward-compat: strips an unknown top-level key and applies the known section', async () => {
    const result = await recognizeConfig({
      windowing: { level: 40, width: 400 },
      futureSection: { enabled: true }, // newer config on an older client
    });
    expect(result.kind).toBe('config');
    if (result.kind === 'config') {
      // Known section is validated + applied...
      expect(result.config.windowing).toEqual({ level: 40, width: 400 });
      // ...the unknown top-level key is stripped and reported...
      expect(result.ignoredKeys).toEqual(['futureSection']);
      // ...and never leaks into the parsed config.
      expect('futureSection' in result.config).toBe(false);
    }
  });

  it('strict on VALUES: a malformed known-section value still throws', async () => {
    // Unknown top-level keys are tolerated, but a broken known section is a real
    // error — the value trust boundary is unchanged.
    await expect(
      recognizeConfig({
        windowing: { level: 'not-a-number' }, // malformed known section
        futureSection: { enabled: true },
      })
    ).rejects.toThrow();
  });

  it('treats a JSON with no known top-level keys as data (silent)', async () => {
    const result = await recognizeConfig({
      vertices: [[0, 0, 0]],
      faces: [[0, 1, 2]],
    });
    expect(result.kind).toBe('data');
  });

  it('treats non-objects and empty objects as data', async () => {
    expect((await recognizeConfig([1, 2, 3])).kind).toBe('data');
    expect((await recognizeConfig('a string')).kind).toBe('data');
    expect((await recognizeConfig(42)).kind).toBe('data');
    expect((await recognizeConfig(null)).kind).toBe('data');
    expect((await recognizeConfig({})).kind).toBe('data');
  });

  // Forward-compat over a mixed JSON: a file carrying a valid `labels` config
  // subset alongside unknown top-level keys applies the known `labels` section
  // and strips the unknowns (reported via ignoredKeys). This is the deliberate
  // forward-compat tradeoff — a top-level known section wins recognition even
  // amid unknown keys, so any unknown top-level keys are stripped, not the whole
  // config dropped.
  it('mixed JSON: applies the known section and strips the unknown top-level keys', async () => {
    const result = await recognizeConfig({
      labels: { defaultLabels: { tumor: { color: '#ff0000' } } },
      vertices: [[0, 0, 0]],
      cells: [[0, 1, 2]],
    });
    expect(result.kind).toBe('config');
    if (result.kind === 'config') {
      expect(result.config.labels).toEqual({
        defaultLabels: { tumor: { color: '#ff0000' } },
      });
      expect(result.ignoredKeys).toContain('vertices');
      expect(result.ignoredKeys).toContain('cells');
    }
  });

  // Self-extension invariant at the recognition layer: a config that tries to
  // carry its own egress allow-list has `allowedOrigins` as an UNKNOWN top-level
  // key, so it is STRIPPED (not applied) — a config can never widen egress. The
  // known `processing` section still parses; the runtime origin gate (same-origin
  // only) remains the sole authority over which providers actually register.
  it('strips a self-extension allow-list rather than honoring it', async () => {
    const result = await recognizeConfig({
      processing: {
        providers: [
          {
            id: 'p',
            label: 'Analysis',
            baseUrl: 'https://analysis.example/api',
            jobsBaseUrl: 'https://analysis.example/api',
          },
        ],
      },
      allowedOrigins: ['https://analysis.example'],
    });
    expect(result.kind).toBe('config');
    if (result.kind === 'config') {
      // The smuggled allow-list is stripped, not carried into the config.
      expect(result.ignoredKeys).toEqual(['allowedOrigins']);
      expect('allowedOrigins' in result.config).toBe(false);
    }
  });
});
