import * as path from 'path';
import * as fs from 'fs';
import type { Options } from '@wdio/types';
import { projectRoot } from './tests/e2eTestUtils';

export const WINDOW_SIZE = [1200, 800] as const;
export const TEST_PORT = 4567;

const ROOT = projectRoot();

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
  exclude: [],
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
        folders: {
          mount: '/',
          path: './dist',
        },
        port: TEST_PORT,
      },
    ],
    [
      'image-comparison',
      {
        baselineFolder: path.resolve(ROOT, 'tests/baseline/'),
        formatImageName:
          '{tag}-{browserName}-{platformName}-{width}x{height}-{dpr}',
        screenshotPath: path.resolve(ROOT, '.tmp/'),
        autoSaveBaseline: true,
      },
    ],
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
    fs.mkdirSync(path.resolve(ROOT, '.tmp/'), { recursive: true });
  },

  async before(caps, spec, browser) {
    await browser.setWindowSize(...WINDOW_SIZE);
  },
};
