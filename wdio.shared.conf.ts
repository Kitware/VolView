import * as path from 'path';
import * as fs from 'fs';
import type { Options } from '@wdio/types';
import { projectRoot } from './tests/e2eTestUtils';

export const WINDOW_SIZE = [1200, 800] as const;
export const TEST_PORT = 4567;
// for slow connections try:
// DOWNLOAD_TIMEOUT=60000 npm run test:e2e:dev
export const DOWNLOAD_TIMEOUT = Number(process.env.DOWNLOAD_TIMEOUT ?? 5000);

const ROOT = projectRoot();
// TEMP_DIR is also downloads directory
const TMP = '.tmp/';
export const TEMP_DIR = path.resolve(ROOT, TMP);
const FIXTURES_DIR = 'tests/fixtures/';
export const FIXTURES = path.resolve(ROOT, FIXTURES_DIR);

export const config: Options.Testrunner = {
  baseUrl: `http://localhost:${TEST_PORT}`,
  // ====================
  // Runner Configuration
  // ====================
  runner: 'local',
  autoCompileOpts: {
    autoCompile: true,
    tsNodeOpts: {
      project: './tsconfig.json',
      transpileOnly: true,
    },
  },
  //
  // ==================
  // Specify Test Files
  // ==================
  specs: ['./tests/specs/**/*.ts'],
  exclude: ['./tests/specs/session-zip.e2e.ts'],
  //
  // ============
  // Capabilities
  // ============
  maxInstances: 3,
  capabilities: [],
  //
  // ===================
  // Test Configurations
  // ===================
  logLevel: 'info',
  bail: 0,
  waitforTimeout: 30000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  services: [
    [
      'static-server',
      {
        folders: [
          {
            mount: '/',
            path: './dist',
          },
          { mount: '/tmp', path: `./${TMP}` },
        ],
        port: TEST_PORT,
      },
    ],
    [
      'image-comparison',
      {
        baselineFolder: path.resolve(ROOT, 'tests/baseline/'),
        formatImageName:
          '{tag}-{browserName}-{platformName}-{width}x{height}-{dpr}',
        screenshotPath: TEMP_DIR,
        autoSaveBaseline: true,
      },
    ],
    'cleanuptotal',
  ],
  framework: 'mocha',
  reporters: ['spec', 'html-nice'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 90 * 1000,
  },

  //
  // Hooks
  //

  onPrepare() {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  },

  async before(caps, spec, browser) {
    await browser.setWindowSize(...WINDOW_SIZE);
  },
};
