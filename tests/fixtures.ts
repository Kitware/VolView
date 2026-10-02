import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  test as base,
  type Browser,
  type BrowserContext,
  type Page,
  type WebError,
} from '@playwright/test';
import { createVolViewPage } from './pageobjects/volview.page';
import { createScratch, createSaveDownload, type Scratch } from './scratch';
import { createUtils } from './specs/utils';
import { createAnnotationUtils } from './specs/annotationTestUtils';
import { createSegmentationUtils } from './specs/segmentationTestUtils';
import { createConfigUtils } from './specs/configTestUtils';
import { createReferenceLinesUtils } from './specs/referenceLinesTestUtils';
import { createOctUtils } from './specs/octTestUtils';
import { createOctInteractionUtils } from './specs/octInteractionTestUtils';
import { createSlabContrastUtils } from './specs/slabContrastTestUtils';
import { createSlabSamplingUtils } from './specs/slabSamplingTestUtils';
import { createLayerDisplayUtils } from './specs/layerDisplayTestUtils';
import { createOverlaySegmentationUtils } from './specs/overlaySegmentationTestUtils';
import { createVolumeUtils } from './specs/volumeTestUtils';
import { createCineUtils } from './specs/cineTestUtils';
import { createProbeUtils } from './specs/probeTestUtils';
import { createViewLayoutUtils } from './specs/viewLayoutTestUtils';

export { expect } from '@playwright/test';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const NETWORK_PROTOCOLS = ['http:', 'https:', 'ws:', 'wss:'];

const WEBGL_FAILURES = [
  'Error compiling shader',
  'CONTEXT_LOST_WEBGL',
  "reading 'setContext'",
  "reading 'oglObject'",
];

// A spec that must reach an address compiled into the app swaps it in the page
// with an init script. Routing stalls the app's data loading.
const isExternal = (rawUrl: string) => {
  const url = new URL(rawUrl);
  return (
    NETWORK_PROTOCOLS.includes(url.protocol) &&
    !LOCAL_HOSTS.includes(url.hostname)
  );
};

// Logged errors carry their stack instead of an opaque object preview.
const stringifyConsoleErrors = () => {
  const originalError = console.error;
  console.error = (...args: unknown[]) =>
    originalError.apply(
      console,
      args.map((arg) => {
        const error = arg instanceof ErrorEvent ? arg.error : arg;
        return error instanceof Error
          ? (error.stack ?? `${error.name}: ${error.message}`)
          : arg;
      })
    );
};

/**
 * Collects what should fail a test the spec itself would sail past: a request
 * that leaves the machine, or a WebGL failure. Listens on the context, which
 * also sees requests made by the page's workers.
 */
const watchPage = (context: BrowserContext) => {
  const externalRequests: string[] = [];
  const webglErrors: string[] = [];
  const record = (level: string, text: string) => {
    console.log(`[Browser Console] [${level}] ${text}`);
    if (WEBGL_FAILURES.some((failure) => text.includes(failure)))
      webglErrors.push(text);
  };
  const onConsole = (message: { type: () => string; text: () => string }) =>
    record(message.type(), message.text());
  const onWebError = (webError: WebError) => {
    const error = webError.error();
    record('pageerror', error.stack ?? String(error));
  };
  const onRequest = (request: { url: () => string }) => {
    if (isExternal(request.url())) externalRequests.push(request.url());
  };
  context.on('console', onConsole);
  context.on('weberror', onWebError);
  context.on('request', onRequest);
  return {
    assertClean: () => {
      const requested = externalRequests.splice(0);
      const failed = webglErrors.splice(0);
      if (requested.length)
        throw new Error(
          `The page requested non-local URLs:\n${requested.join('\n')}`
        );
      if (failed.length)
        throw new Error(`WebGL failed during the test:\n${failed.join('\n')}`);
    },
    dispose: () => {
      context.off('console', onConsole);
      context.off('weberror', onWebError);
      context.off('request', onRequest);
    },
  };
};

type PageWatch = ReturnType<typeof watchPage>;

export const test = base.extend<{
  scratch: Scratch;
  saveDownload: ReturnType<typeof createSaveDownload>;
  pageWatch: PageWatch;
  failOnPageTrouble: void;
  volview: ReturnType<typeof createVolViewPage>;
  utils: ReturnType<typeof createUtils>;
  annotation: ReturnType<typeof createAnnotationUtils>;
  segmentation: ReturnType<typeof createSegmentationUtils>;
  configUtils: ReturnType<typeof createConfigUtils>;
  referenceLines: ReturnType<typeof createReferenceLinesUtils>;
  oct: ReturnType<typeof createOctUtils>;
  octInteraction: ReturnType<typeof createOctInteractionUtils>;
  slabContrast: ReturnType<typeof createSlabContrastUtils>;
  slabSampling: ReturnType<typeof createSlabSamplingUtils>;
  layerDisplay: ReturnType<typeof createLayerDisplayUtils>;
  overlaySegmentation: ReturnType<typeof createOverlaySegmentationUtils>;
  volume: ReturnType<typeof createVolumeUtils>;
  cine: ReturnType<typeof createCineUtils>;
  probe: ReturnType<typeof createProbeUtils>;
  layout: ReturnType<typeof createViewLayoutUtils>;
}>({
  context: async ({ context }, use) => {
    await context.addInitScript(stringifyConsoleErrors);
    await use(context);
  },
  scratch: async ({}, use) => {
    const scratch = createScratch();
    await use(scratch);
    scratch.cleanup();
  },
  pageWatch: async ({ context }, use) => {
    const watch = watchPage(context);
    await use(watch);
    watch.dispose();
  },
  failOnPageTrouble: [
    async ({ pageWatch }, use) => {
      await use();
      pageWatch.assertClean();
    },
    { auto: true },
  ],
  saveDownload: ({ page, scratch }, use) =>
    use(createSaveDownload(page, scratch)),
  volview: ({ page, scratch }, use) => use(createVolViewPage(page, scratch)),
  utils: ({ page, scratch }, use) => use(createUtils(page, scratch)),
  annotation: ({ page, scratch }, use) =>
    use(createAnnotationUtils(page, scratch)),
  segmentation: ({ page, scratch }, use) =>
    use(createSegmentationUtils(page, scratch)),
  configUtils: ({ page, scratch }, use) =>
    use(createConfigUtils(page, scratch)),
  referenceLines: ({ page, scratch }, use) =>
    use(createReferenceLinesUtils(page, scratch)),
  oct: ({ page, scratch }, use) => use(createOctUtils(page, scratch)),
  octInteraction: ({ page, scratch }, use) =>
    use(createOctInteractionUtils(page, scratch)),
  slabContrast: ({ page, scratch }, use) =>
    use(createSlabContrastUtils(page, scratch)),
  slabSampling: ({ page }, use) => use(createSlabSamplingUtils(page)),
  layerDisplay: ({ page, scratch }, use) =>
    use(createLayerDisplayUtils(page, scratch)),
  overlaySegmentation: ({ page, scratch }, use) =>
    use(createOverlaySegmentationUtils(page, scratch)),
  volume: ({ page, scratch }, use) => use(createVolumeUtils(page, scratch)),
  cine: ({ page, scratch }, use) => use(createCineUtils(page, scratch)),
  probe: ({ page }, use) => use(createProbeUtils(page)),
  layout: ({ page, scratch }, use) => use(createViewLayoutUtils(page, scratch)),
});

const openSharedPage = async (browser: Browser) => {
  const context = await browser.newContext();
  await context.addInitScript(stringifyConsoleErrors);
  const watch = watchPage(context);
  return { page: await context.newPage(), watch, scratch: createScratch() };
};

/**
 * For a describe block whose tests build on each other's page state: its tests
 * run in order on one page, opened before the first and closed after the last.
 * `setup` stands in for the old `before` hook. Call it first in the block.
 */
export const useSharedPage = (
  setup?: (page: Page, scratch: Scratch) => Promise<void>
) => {
  test.describe.configure({ mode: 'serial' });
  const shared: Partial<Awaited<ReturnType<typeof openSharedPage>>> = {};
  const required = <T>(value: T | undefined) => {
    if (value === undefined) throw new Error('The shared page failed to open');
    return value;
  };

  test.beforeAll(async ({ browser }) => {
    Object.assign(shared, await openSharedPage(browser));
    await setup?.(required(shared.page), required(shared.scratch));
  });

  test.afterAll(async () => {
    shared.watch?.dispose();
    shared.scratch?.cleanup();
    await shared.page?.context().close();
  });

  test.use({
    page: async ({}, use) => use(required(shared.page)),
    context: async ({}, use) => use(required(shared.page).context()),
    // Shared with the hook, so trouble during setup fails the first test.
    pageWatch: async ({}, use) => use(required(shared.watch)),
  });
};

/**
 * Turns the Reference Lines setting on through Settings before each test. The
 * setting lives in local storage, which a fresh page per test does not keep.
 */
export const useReferenceLines = () =>
  test.beforeEach(async ({ volview, referenceLines }) => {
    await volview.open();
    await referenceLines.setReferenceLinesEnabled(true);
  });

/**
 * Reference lines on for every test, and with VOLVIEW_OCT_CAPTURE_DIR set, a
 * screenshot of each failed test written there.
 */
export const registerOctTestHooks = () => {
  useReferenceLines();
  test.afterEach(async ({ page }, testInfo) => {
    const captureDirectory = process.env.VOLVIEW_OCT_CAPTURE_DIR;
    if (captureDirectory && testInfo.status !== testInfo.expectedStatus) {
      fs.mkdirSync(captureDirectory, { recursive: true });
      await page.screenshot({
        path: path.join(
          captureDirectory,
          'failure-' + testInfo.title.slice(0, 20) + '.png'
        ),
      });
    }
  });
};
