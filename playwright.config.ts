import * as path from 'node:path';
import { defineConfig } from '@playwright/test';
import { BASE_URL, TEST_PORT } from './tests/e2ePorts';
import {
  BROWSER_DOWNLOADS,
  CONTENT_VIEWPORT,
  IS_CI,
  TEMP_DIR,
} from './tests/e2eRun';

const IS_LINUX_CI = IS_CI && process.platform === 'linux';
const IS_DEV = !!process.env.E2E_DEV;
// A port of this checkout's own, below the range the static servers use.
const DEV_SERVER_PORT = TEST_PORT - 10000;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

// Playwright clears its output directory before the webServer claims the port,
// so each invocation writes under a directory of its own. Workers inherit the
// id through the environment.
process.env.VOLVIEW_E2E_RUN_ID ??= String(Date.now());
const RUN_DIR = path.join(TEMP_DIR, `run-${process.env.VOLVIEW_E2E_RUN_ID}`);

// Both budgets assume a machine busy with other suites. Raise these rather
// than giving a test or a wait a limit of its own.
const TEST_BUDGET = 360_000;
const WAIT_BUDGET = 60_000;

const chromiumArgs = [
  '--enable-unsafe-swiftshader',
  ...(IS_CI ? ['--disable-dev-shm-usage'] : []),
  ...(IS_LINUX_CI ? ['--use-gl=angle', '--use-angle=swiftshader-webgl'] : []),
];

export default defineConfig({
  testDir: './tests/specs',
  testMatch: '**/*.e2e.ts',
  // sample-rendering.e2e.ts does not work against the dev server.
  testIgnore: IS_DEV ? ['**/sample-rendering.e2e.ts'] : [],
  outputDir: path.join(RUN_DIR, 'results'),
  snapshotPathTemplate: 'tests/baseline/{arg}{ext}',
  // A missing baseline is written and passes locally. On CI it would turn a
  // renamed screenshot into a test that compares nothing.
  updateSnapshots: IS_CI ? 'none' : 'missing',
  // WebGL rendering is heavy enough that more local browsers starve one another.
  workers: IS_CI ? 1 : 3,
  fullyParallel: false,
  retries: 0,
  timeout: TEST_BUDGET,
  expect: { timeout: WAIT_BUDGET },
  // CI shards each write a blob, and the workflow merges them into one HTML
  // report per OS.
  reporter: [
    ['list'],
    IS_CI
      ? ['blob', { outputDir: 'blob-report' }]
      : ['html', { outputFolder: path.join(RUN_DIR, 'report'), open: 'never' }],
    ['./tests/runDirReporter.ts'],
  ],
  globalSetup: './tests/globalSetup.ts',
  webServer: [
    {
      command: `node tests/server/static-server.ts ${TEST_PORT} dist "${TEMP_DIR}"`,
      port: TEST_PORT,
      reuseExistingServer: false,
    },
    ...(IS_DEV
      ? [
          {
            command: `npm run dev -- --port ${DEV_SERVER_PORT} --strictPort`,
            url: DEV_SERVER_URL,
            reuseExistingServer: true,
          },
        ]
      : []),
  ],
  use: {
    baseURL: IS_DEV ? DEV_SERVER_URL : BASE_URL,
    viewport: CONTENT_VIEWPORT,
    deviceScaleFactor: 1,
    // An action waiting on its target is a wait like any other. Without this a
    // click on a control that never enables holds the test for its whole budget.
    actionTimeout: WAIT_BUDGET,
    // Recording costs about half a second per test, so local runs opt in with
    // --trace.
    trace: IS_CI ? 'retain-on-failure' : 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        channel: 'chromium',
        launchOptions: { args: chromiumArgs, downloadsPath: BROWSER_DOWNLOADS },
      },
    },
  ],
});
