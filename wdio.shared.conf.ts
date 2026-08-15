import * as path from 'path';
import * as fs from 'fs';
import { createServer } from 'net';
import type { Options, Capabilities } from '@wdio/types';
import { SevereServiceError } from 'webdriverio';
import { projectRoot } from './tests/e2eTestUtils';
import { AUX_PORT, BASE_URL, TEST_PORT } from './tests/e2ePorts';

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

// for slow connections try:
// DOWNLOAD_TIMEOUT=60000 && npm run test:e2e:dev
export const DOWNLOAD_TIMEOUT = Number(process.env.DOWNLOAD_TIMEOUT ?? 30000);

const IS_CI = !!(process.env.CI || process.env.GITHUB_ACTIONS);

const ROOT = projectRoot();
const TMP = '.tmp/';
// Fixtures are downloaded once and shared by every run.
export const DATASET_CACHE = path.resolve(ROOT, TMP, 'datasets');
// Everything a run generates or downloads through the browser, including the
// fixture links it serves. Also the browser downloads directory. Keyed by port
// so a checkout, or an overridden port, gets scratch space of its own.
export const TEMP_DIR = path.resolve(ROOT, TMP, 'runs', String(TEST_PORT));
const FIXTURES_DIR = 'tests/fixtures/';
export const FIXTURES = path.resolve(ROOT, FIXTURES_DIR);

// The static server and the browser's download directory both point into
// TEMP_DIR, and Windows refuses to unlink a file while a handle is open, so give
// their teardown a moment to catch up.
const removeDir = (dir: string) =>
  fs.rmSync(dir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });

/**
 * Exposes a cached fixture under this run's directory, so specs can reach it at
 * `/tmp/<name>` without every run holding its own copy.
 */
export function linkCachedDataset(name: string) {
  const runPath = path.join(TEMP_DIR, name);
  if (fs.existsSync(runPath)) return runPath;

  fs.mkdirSync(TEMP_DIR, { recursive: true });
  try {
    fs.linkSync(path.join(DATASET_CACHE, name), runPath);
  } catch {
    // A hard link needs one filesystem; a copy always works.
    fs.copyFileSync(path.join(DATASET_CACHE, name), runPath);
  }
  return runPath;
}

const inUse = (port: number) =>
  new Promise<boolean>((resolve) => {
    const server = createServer()
      .once('error', (err: NodeJS.ErrnoException) =>
        resolve(err.code === 'EADDRINUSE')
      )
      .once('listening', () => server.close(() => resolve(false)));
    server.listen(port);
  });

const NAMED_PORTS = [
  ['VOLVIEW_E2E_PORT', TEST_PORT],
  ['VOLVIEW_E2E_AUX_PORT', AUX_PORT],
] as const;

/**
 * These ports are stable, not reserved, so a suite already running out of this
 * checkout, a checkout that hashed the same way, or an unrelated process can be
 * holding one.
 */
async function assertPortsAvailable() {
  const checks = await Promise.all(
    NAMED_PORTS.map(async ([name, port]) =>
      (await inUse(port)) ? `${port} (${name})` : null
    )
  );
  const taken = checks.filter(Boolean);
  if (taken.length) {
    // Anything less severe is logged and the run carries on without a server.
    throw new SevereServiceError(
      `E2E ports already in use: ${taken.join(', ')}. Set the named variables to free ports to run anyway.`
    );
  }
}

export const config: Options.Testrunner = {
  baseUrl: BASE_URL,
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
  // WebGL rendering is resource-intensive enough that six local Chrome
  // instances can starve one another and exceed view-rendering timeouts.
  maxInstances: IS_CI ? 1 : 3,
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
          { mount: '/tmp', path: TEMP_DIR },
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
    timeout: 90_000,
  },

  //
  // Hooks
  //

  async onPrepare() {
    // Bail before the wipe below, which would otherwise take out the scratch
    // directory of whichever suite is already holding the port.
    await assertPortsAvailable();

    fs.mkdirSync(DATASET_CACHE, { recursive: true });
    // Start empty, so whatever is in here afterwards came from this run.
    removeDir(TEMP_DIR);
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
      const savePath = path.join(DATASET_CACHE, name);
      if (!fs.existsSync(savePath)) {
        for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
          try {
            await downloadOnce(url, savePath);
            break;
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
      }
      linkCachedDataset(name);
    });
    await Promise.all(downloads);
  },

  async onComplete(exitCode, completedConfig) {
    // A failed run keeps its directory: the screenshots and downloads in it are
    // what there is to look at. Watch mode reports 0 whatever the tests did,
    // since quitting it is not a failure. CI keeps its directory either way,
    // because a passing run is exactly where a new baseline image gets picked
    // up from the uploaded artifact.
    if (exitCode === 0 && !completedConfig.watch && !IS_CI) {
      removeDir(TEMP_DIR);
    }
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
