import * as path from 'path';
import type { Options } from '@wdio/types';
import { projectRoot } from './tests/e2eTestUtils';

const TEST_PORT = 4567;
const WINDOW_SIZE = [1280, 800] as const;
const ROOT = projectRoot();

export const config: Options.Testrunner = {
  //
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
  maxInstances: 10,
  capabilities: [
    {
      browserName: 'chrome',
    },
    {
      browserName: 'firefox',
    },
    // {
    //   browserName: 'microsoftedge',
    // },
    // {
    //   browserName: 'safari',
    // },
  ],
  //
  // ===================
  // Test Configurations
  // ===================
  // Level of logging verbosity: trace | debug | info | warn | error | silent
  logLevel: 'info',
  // If you only want to run your tests until a specific amount of tests have failed use
  // bail (default is 0 - don't bail, run all tests).
  bail: 0,
  //
  // Set a base URL in order to shorten url command calls. If your `url` parameter starts
  // with `/`, the base url gets prepended, not including the path portion of your baseUrl.
  // If your `url` parameter starts without a scheme or `/` (like `some/path`), the base url
  // gets prepended directly.
  baseUrl: `http://localhost:${TEST_PORT}`,
  //
  // Default timeout for all waitFor* commands.
  waitforTimeout: 10000,
  //
  // Default timeout in milliseconds for request
  // if browser driver or grid doesn't send response
  connectionRetryTimeout: 120000,
  //
  // Default request retries count
  connectionRetryCount: 3,
  //
  // Test runner services
  services: [
    'chromedriver',
    'geckodriver',
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
        formatImageName: '{tag}-{browserName}-{width}x{height}',
        screenshotPath: path.resolve(ROOT, '.tmp/'),
        autoSaveBaseline: true,
      },
    ],
  ],

  // Framework you want to run your specs with.
  // The following are supported: Mocha, Jasmine, and Cucumber
  framework: 'mocha',

  reporters: ['spec', 'html-nice'],

  //
  // Options to be passed to Mocha.
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },

  // hooks
  async before(caps, spec, browser) {
    await browser.setWindowSize(...WINDOW_SIZE);
  },
};
