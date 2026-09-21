import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';
import { createServer } from 'net';
import type { Options, Capabilities } from '@wdio/types';
import { SevereServiceError } from 'webdriverio';
import { projectRoot } from './tests/e2eTestUtils';
import { AUX_PORT, BASE_URL, TEST_PORT } from './tests/e2ePorts';
import {
  DATASET_RELEASE,
  TEST_DATASETS,
  type TestDataset,
} from './tests/datasets';

// Fixed capture viewport (Playwright's default).
export const CONTENT_VIEWPORT = { width: 1280, height: 720 } as const;

// Pin the content viewport so capture geometry is stable across Chrome versions
// and OSes (independent of the OS window). Enables one shared baseline.
export const applyTestViewport = (browser: any) =>
  browser.setViewport({ ...CONTENT_VIEWPORT, devicePixelRatio: 1 });

// How long data may take to load and render. Nothing here crosses the network.
export const DOWNLOAD_TIMEOUT = Number(process.env.DOWNLOAD_TIMEOUT ?? 30000);

const IS_CI = !!(process.env.CI || process.env.GITHUB_ACTIONS);

const ROOT = projectRoot();
const TMP = '.tmp/';
// Fixtures are downloaded once and shared by every run.
const DATASET_CACHE = path.resolve(ROOT, TMP, 'datasets');
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
function linkCachedDataset(name: string) {
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

const sha256 = (data: Buffer) =>
  createHash('sha256').update(data).digest('hex');

// The only place the suite reaches the internet. Severe, so a slow or missing
// host stops the run and never shows up as a failing spec.
async function fetchDataset(dataset: TestDataset) {
  const url = `${DATASET_RELEASE}/${dataset.name}`;
  const fail = (reason: string) =>
    new SevereServiceError(
      `Could not download test dataset ${dataset.name} from ${url}: ${reason}`
    );

  const response = await fetch(url).catch((err: Error) => {
    throw fail(err.message);
  });
  if (!response.ok) throw fail(`HTTP ${response.status}`);

  const data = Buffer.from(await response.arrayBuffer());
  const actual = sha256(data);
  if (actual !== dataset.sha256) {
    throw fail(`sha256 is ${actual}, expected ${dataset.sha256}`);
  }
  return data;
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
    require: ['./tests/rootHooks.ts'],
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

    await Promise.all(
      TEST_DATASETS.map(async (dataset) => {
        const savePath = path.join(DATASET_CACHE, dataset.name);
        // A cached file is only good while it is the file this checkout names.
        const cached =
          fs.existsSync(savePath) &&
          sha256(fs.readFileSync(savePath)) === dataset.sha256;
        if (!cached) {
          // Rename into place so an interrupted write never looks cached.
          fs.writeFileSync(`${savePath}.part`, await fetchDataset(dataset));
          fs.renameSync(`${savePath}.part`, savePath);
        }
        linkCachedDataset(dataset.name);
      })
    );
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
