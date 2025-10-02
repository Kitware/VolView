import * as path from 'path';
import * as fs from 'fs';
import type { Options, Capabilities } from '@wdio/types';
import { projectRoot } from './tests/e2eTestUtils';

export const WINDOW_SIZE = [1200, 800] as const;
export const TEST_PORT = 4567;
// for slow connections try:
// DOWNLOAD_TIMEOUT=60000 && npm run test:e2e:dev
export const DOWNLOAD_TIMEOUT = Number(process.env.DOWNLOAD_TIMEOUT ?? 60000);

const ROOT = projectRoot();
const TMP = '.tmp/';
// TEMP_DIR is also browser downloads directory
export const TEMP_DIR = path.resolve(ROOT, TMP);
const FIXTURES_DIR = 'tests/fixtures/';
export const FIXTURES = path.resolve(ROOT, FIXTURES_DIR);

export const config: Options.Testrunner = {
  baseUrl: `http://localhost:${TEST_PORT}`,
  // ====================
  // Runner Configuration
  // ====================
  runner: 'local',
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
  //
  // ===================
  // Test Configurations
  // ===================
  logLevel: 'warn',
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
      'visual',
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
    timeout: 160 * 1000,
  },

  //
  // Hooks
  //

  onPrepare() {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  },

  async before(
    _capabilities:
      | Capabilities.RequestedStandaloneCapabilities
      | Capabilities.RequestedMultiremoteCapabilities,
    _specs: string[],
    browser: any
  ) {
    await browser.setWindowSize(...WINDOW_SIZE);

    // Subscribe to browser console logs and output them directly
    await browser.sessionSubscribe({ events: ['log.entryAdded'] });

    browser.on('log.entryAdded', (logEntry: any) => {
      const message = logEntry.text || '';
      console.log(`[Browser Console] [${logEntry.level}] ${message}`);
    });
  },

  async afterCommand(commandName: string) {
    // After navigation, inject console interceptor to stringify errors
    if (commandName === 'navigateTo' || commandName === 'url') {
      await browser.execute(() => {
        if (!(console.error as any).__patched) {
          const originalError = console.error;
          console.error = (...args: any[]) => {
            const stringArgs = args.map((arg) =>
              arg instanceof Error ? `${arg.name}: ${arg.message}` : arg
            );
            originalError.apply(console, stringArgs);
          };
          (console.error as any).__patched = true;
        }
      });
    }
  },
};
