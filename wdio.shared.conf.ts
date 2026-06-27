import * as path from 'path';
import * as fs from 'fs';
import type { Options, Capabilities } from '@wdio/types';
import { projectRoot } from './tests/e2eTestUtils';

const TEST_DATASETS = [
  {
    url: 'https://data.kitware.com/api/v1/file/6566aa81c5a2b36857ad1783/download',
    name: 'CT000085.dcm',
  },
  {
    url: 'https://data.kitware.com/api/v1/file/68e9807dbf0f869935e36481/download',
    name: 'minimal.dcm',
  },
  {
    url: 'https://data.kitware.com/api/v1/item/63527c7311dab8142820a338/download',
    name: 'prostate.zip',
  },
  {
    url: 'https://data.kitware.com/api/v1/item/6352a2b311dab8142820a33b/download',
    name: 'MRA-Head_and_Neck.zip',
  },
  {
    url: 'https://data.kitware.com/api/v1/item/635679c311dab8142820a4f4/download',
    name: 'fetus.zip',
  },
  {
    url: 'https://sourceforge.net/p/gdcm/gdcmdata/ci/master/tree/US-MONO2-8-8x-execho.dcm?format=raw',
    name: 'US-MONO2-8-8x-echo.dcm',
  },
];

// Fixed capture viewport (Playwright's default).
export const CONTENT_VIEWPORT = { width: 1280, height: 720 } as const;

// Pin the content viewport so capture geometry is stable across Chrome versions
// and OSes (independent of the OS window). Enables one shared baseline.
export const applyTestViewport = (browser: any) =>
  browser.setViewport({ ...CONTENT_VIEWPORT, devicePixelRatio: 1 });

export const TEST_PORT = 4567;
// for slow connections try:
// DOWNLOAD_TIMEOUT=60000 && npm run test:e2e:dev
export const DOWNLOAD_TIMEOUT = Number(process.env.DOWNLOAD_TIMEOUT ?? 20000);

const IS_CI = !!(process.env.CI || process.env.GITHUB_ACTIONS);

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
  specs: ['./tests/specs/**/*.e2e.ts'],
  exclude: [],
  //
  // ============
  // Capabilities
  // ============
  maxInstances: IS_CI ? 1 : 6,
  //
  // ===================
  // Test Configurations
  // ===================
  logLevel: 'warn',
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 90000,
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
        // Pinned geometry, so no {platformName}/{width}x{height}; one shared baseline.
        formatImageName: '{tag}-{browserName}-{dpr}',
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
    timeout: 60000,
  },

  //
  // Hooks
  //

  async onPrepare() {
    fs.mkdirSync(TEMP_DIR, { recursive: true });

    const RETRIES = 3;
    const RETRY_DELAY_MS = 500;
    const delay = (ms: number) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
    const downloadOnce = async (url: string, savePath: string) => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      const data = await response.arrayBuffer();
      // Write to a temp path first so a failed/partial download never leaves a
      // corrupt file that the existsSync check would treat as already cached.
      const tmpPath = `${savePath}.part`;
      fs.writeFileSync(tmpPath, Buffer.from(data));
      fs.renameSync(tmpPath, savePath);
    };

    const downloads = TEST_DATASETS.map(async ({ url, name }) => {
      const savePath = path.join(TEMP_DIR, name);
      if (fs.existsSync(savePath)) {
        return;
      }
      for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
        try {
          await downloadOnce(url, savePath);
          return;
        } catch (err) {
          if (attempt === RETRIES) {
            throw new Error(
              `Failed to download ${name} after ${RETRIES} attempts: ${
                (err as Error).message
              }`
            );
          }
          await delay(RETRY_DELAY_MS);
        }
      }
    });
    await Promise.all(downloads);
  },

  async before(
    _capabilities:
      | Capabilities.RequestedStandaloneCapabilities
      | Capabilities.RequestedMultiremoteCapabilities,
    _specs: string[],
    browser: any
  ) {
    await applyTestViewport(browser);

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
