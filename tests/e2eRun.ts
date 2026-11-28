import * as path from 'node:path';
import { expect } from '@playwright/test';
import { projectRoot } from './e2eTestUtils';
import { TEST_PORT } from './e2ePorts';

export const IS_CI = !!(process.env.CI || process.env.GITHUB_ACTIONS);

// Pinned so capture geometry, and with it one shared baseline, does not depend
// on the OS window.
export const CONTENT_VIEWPORT = { width: 1280, height: 720 } as const;

// For a wait on large data. It has no limit of its own, so the test's budget
// bounds it; pair it with test.slow().
export const expectWithinTest = expect.configure({ timeout: 0 });

// Everything a run writes, served at /tmp. Keyed by port so runs on different
// ports never share it.
export const TEMP_DIR = path.resolve(
  projectRoot(),
  '.tmp/runs',
  String(TEST_PORT)
);

// Where the browser writes a download before saveDownload copies it out.
export const BROWSER_DOWNLOADS = path.join(TEMP_DIR, 'browser-downloads');

export const FIXTURES = path.resolve(projectRoot(), 'tests/fixtures');
