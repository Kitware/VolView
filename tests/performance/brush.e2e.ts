import { Key } from 'webdriverio';
import { DATASET_CACHE } from '../downloadDatasets';
import { writeFullAllocationSession } from './fullAllocationSession';
import { TEMP_DIR } from '../../wdio.shared.conf';
import {
  selectTwoRowLayout,
  selectEnFace,
  waitForEnFaceReady,
  openEnFaceControls,
  expandEnFaceSection,
  selectSetting,
  setHighlight,
  setThicknessThreshold,
} from '../specs/octTestUtils';
import fs from 'node:fs';
import { connectProfiler } from './cpuProfile';
import path from 'node:path';
import { JHU_RETINAL_LAYERS } from '../datasets';
import { volViewPage } from '../pageobjects/volview.page';
import { openUrls, openVolViewPage } from '../specs/utils';
import {
  openAnnotationSegments,
  openSegmentDisplay,
  selectSegment,
  setSegmentationDisplaySlider,
  waitForSegmentContent,
} from '../specs/segmentationTestUtils';

const output = path.resolve(
  process.env.BRUSH_BENCH_OUTPUT ?? '.tmp/brush-benchmark'
);
const variant = process.env.BRUSH_BENCH_VARIANT ?? 'current';
const points = Number(
  process.env.BRUSH_BENCH_POINTS ?? (process.env.BRUSH_BENCH_LARGE ? 30 : 180)
);
const cycles = Number(process.env.BRUSH_BENCH_CYCLES ?? 3);
let profiler: Awaited<ReturnType<typeof connectProfiler>> | undefined;

async function installProbe() {
  await browser.addInitScript(() => {
    const probe = {
      active: false,
      startedAt: 0,
      frames: [] as number[],
      pointerDelays: [] as number[],
      longTasks: [] as number[],
      draws: 0,
      drawMs: 0,
      graphics: null as unknown,
      lastFrame: 0,
    };
    Object.assign(window, { brushBenchmark: probe });
    const tick = (now: number) => {
      if (probe.active && probe.lastFrame)
        probe.frames.push(now - probe.lastFrame);
      probe.lastFrame = probe.active ? now : 0;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.addEventListener(
      'pointermove',
      () => {
        if (!probe.active) return;
        const start = performance.now();
        requestAnimationFrame(() => {
          if (probe.active) probe.pointerDelays.push(performance.now() - start);
        });
      },
      true
    );
    for (const eventName of ['pointerdown', 'pointerup']) {
      window.addEventListener(
        eventName,
        () => {
          if (probe.active) performance.mark(`brush-${eventName}`);
        },
        true
      );
    }
    new PerformanceObserver((list) => {
      if (probe.active)
        probe.longTasks.push(
          ...list
            .getEntries()
            .filter((entry) => entry.startTime >= probe.startedAt)
            .map((entry) => entry.duration)
        );
    }).observe({ type: 'longtask', buffered: false });
    for (const name of ['drawArrays', 'drawElements'] as const) {
      const original = WebGL2RenderingContext.prototype[name];
      Object.defineProperty(WebGL2RenderingContext.prototype, name, {
        value: function (this: WebGL2RenderingContext, ...args: unknown[]) {
          if (!probe.graphics) {
            const debug = this.getExtension('WEBGL_debug_renderer_info');
            probe.graphics = {
              renderer: this.getParameter(
                debug?.UNMASKED_RENDERER_WEBGL ?? this.RENDERER
              ),
              vendor: this.getParameter(
                debug?.UNMASKED_VENDOR_WEBGL ?? this.VENDOR
              ),
            };
          }
          if (!probe.active) return Reflect.apply(original, this, args);
          const start = performance.now();
          const result = Reflect.apply(original, this, args);
          probe.drawMs += performance.now() - start;
          probe.draws += 1;
          return result;
        },
      });
    }
  });
}

const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  };
};

async function measure(
  label: string,
  center: { x: number; y: number },
  paint = false
) {
  const x = Math.round(center.x);
  const y = Math.round(center.y);
  await browser
    .action('pointer', { id: 'brush-benchmark' })
    .move({ x: x - 80, y, duration: 0 })
    .perform(true);
  await profiler?.start();
  await browser.execute(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
    performance.clearMeasures();
    performance.clearMarks();
    performance.mark('brush-measurement-start');
    const probe = (window as any).brushBenchmark;
    Object.assign(probe, {
      active: true,
      startedAt: performance.now(),
      frames: [],
      pointerDelays: [],
      longTasks: [],
      draws: 0,
      drawMs: 0,
      lastFrame: 0,
    });
  });
  const start = Date.now();
  const action = browser.action('pointer', { id: 'brush-benchmark' });
  if (paint) action.down();
  for (let i = 0; i < points; i++) {
    action.move({
      x: x + Math.round(80 * Math.sin((i * cycles * 2 * Math.PI) / points)),
      y:
        y +
        Math.round(25 * Math.cos((i * cycles * 2 * Math.PI) / points)) +
        12 * Math.floor((i * cycles) / points),
      duration: 16,
    });
  }
  if (paint) action.up();
  await action.perform(true);
  const elapsedMs = Date.now() - start;
  const raw = await browser.execute(() => {
    const probe = (window as any).brushBenchmark;
    probe.active = false;
    performance.mark('brush-action-end');
    return { ...probe };
  });
  if (profiler) {
    const { profile } = await profiler.stop();
    fs.writeFileSync(
      path.join(output, `${variant}-${label}.cpuprofile`),
      JSON.stringify(profile)
    );
  }
  const result = {
    label,
    paint,
    elapsedMs,
    frameMs: summary(raw.frames),
    pointerToRafMs: summary(raw.pointerDelays),
    draws: raw.draws,
    drawCallWallMs: raw.drawMs,
    longTasks: raw.longTasks,
    raw,
  };
  console.log('BRUSH_BENCHMARK', JSON.stringify({ ...result, raw: undefined }));
  return result;
}

describe('Retinal brush performance observations', () => {
  before(installProbe);
  afterEach(() => {
    profiler?.close();
    profiler = undefined;
  });
  for (const brushSize of (process.env.BRUSH_SIZES ?? '4,52')
    .split(',')
    .map(Number))
    for (const highlight of (process.env.BRUSH_HIGHLIGHTS ?? 'false,true')
      .split(',')
      .map((value) => value === 'true')) {
      it(`measures actual axial stroke with enface, brush ${brushSize}, highlight ${highlight}`, async () => {
        fs.mkdirSync(output, { recursive: true });
        if (process.env.BRUSH_BENCH_LARGE)
          await browser.setViewport({
            width: 1920,
            height: 1080,
            devicePixelRatio: 2,
          });
        if (process.env.BRUSH_BENCH_INPUT) {
          const name = path.basename(process.env.BRUSH_BENCH_INPUT);
          fs.copyFileSync(
            process.env.BRUSH_BENCH_INPUT,
            path.join(TEMP_DIR, name)
          );
          await openVolViewPage(name);
        } else if (process.env.BRUSH_BENCH_FULL_ALLOCATION === '1') {
          const name = 'jhu-full-allocation.volview.zip';
          const destination = path.join(TEMP_DIR, name);
          if (!fs.existsSync(destination))
            await writeFullAllocationSession(
              path.join(DATASET_CACHE, JHU_RETINAL_LAYERS.name),
              destination
            );
          await openVolViewPage(name);
        } else await openUrls([JHU_RETINAL_LAYERS]);
        await selectTwoRowLayout();
        await selectEnFace(1);
        await waitForEnFaceReady();
        await openEnFaceControls();
        await expandEnFaceSection('thickness');
        await selectSetting(
          'enface-segmentation-segment',
          'Retinal nerve fiber layer (RNFL)'
        );
        await setHighlight(highlight);
        if (highlight) await setThicknessThreshold(100);
        await browser.keys('Escape');
        await waitForEnFaceReady();
        await (await volViewPage.getViews2D())[0].$('canvas').click();
        await volViewPage.activatePaint();
        await openAnnotationSegments();
        await waitForSegmentContent('Retinal nerve fiber layer (RNFL)');
        await waitForSegmentContent('Retinal pigment epithelium (RPE)');
        await selectSegment('Retinal nerve fiber layer (RNFL)');
        const views = await volViewPage.getViews2D();
        const canvas = await views[0].$('canvas');
        const bounds = await canvas.getLocation();
        const size = await canvas.getSize();
        const center = {
          x: bounds.x + size.width / 2,
          y: bounds.y + size.height / 2 - 20,
        };
        const lock = $('[data-testid="toggle-segments-locked-button"]');
        if ((await lock.getAttribute('aria-label')) === 'Unlock every segment')
          await lock.click();
        await expect(lock).toHaveAttribute('aria-label', 'Lock every segment');
        if (process.env.BRUSH_BENCH_PROFILE) {
          const options = (
            browser.capabilities as unknown as Record<
              string,
              { debuggerAddress: string }
            >
          )['goog:chromeOptions'];
          profiler = await connectProfiler(options.debuggerAddress);
        }
        const results = [];
        await openSegmentDisplay();
        await setSegmentationDisplaySlider(
          'Outline Thickness',
          Number(process.env.BRUSH_OUTLINE_THICKNESS ?? 1)
        );
        const visibleMasks = Number(process.env.BRUSH_VISIBLE_MASKS ?? 8);
        const slider = $('[role="slider"][aria-label="Brush size"]');
        if (Number(await slider.getAttribute('aria-valuenow')) !== brushSize) {
          await slider.scrollIntoView({ block: 'center' });
          await slider.waitForStable();
          await slider.execute((element) => (element as HTMLElement).focus());
          const keys = browser.action('key').down(Key.Home).up(Key.Home);
          for (let i = 1; i < brushSize; i++)
            keys.down(Key.ArrowRight).up(Key.ArrowRight);
          await keys.perform();
          await expect(slider).toHaveAttribute(
            'aria-valuenow',
            String(brushSize)
          );
        }
        const raster = async () => {
          await $('header').moveTo();
          return browser.execute(async (element) => {
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve())
              )
            );
            return (element as HTMLCanvasElement).toDataURL();
          }, canvas);
        };
        const before = await raster();
        if (visibleMasks < 8) {
          await $('[data-testid="toggle-segments-visible-button"]').click();
          if (visibleMasks === 1)
            await $(
              'button[aria-label="Show Retinal nerve fiber layer (RNFL)"]'
            ).click();
        }
        results.push(
          await measure(
            `brush-${brushSize}-highlight-${highlight}-stroke`,
            center,
            true
          )
        );
        if (visibleMasks < 8)
          await $('[data-testid="toggle-segments-visible-button"]').click();
        const settleStart = Date.now();
        await waitForEnFaceReady();
        const settleMs = Date.now() - settleStart;
        expect(await raster()).not.toBe(before);
        const performanceEntries = await browser.execute(async () => {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          );
          performance.mark('brush-settled');
          return {
            measures: performance.getEntriesByType('measure').map((entry) => ({
              name: entry.name,
              startTime: entry.startTime,
              duration: entry.duration,
              detail: (entry as PerformanceMeasure).detail,
            })),
            marks: performance.getEntriesByType('mark').map((entry) => ({
              name: entry.name,
              startTime: entry.startTime,
            })),
          };
        });
        await browser.saveScreenshot(
          path.join(output, `${variant}-${brushSize}-${highlight}.png`)
        );
        fs.writeFileSync(
          path.join(output, `${variant}-${brushSize}-${highlight}.json`),
          JSON.stringify(
            {
              variant: `${variant}-${brushSize}-${highlight}`,
              brushSize,
              highlight,
              settleMs,
              performanceEntries,
              inputFile: process.env.BRUSH_BENCH_INPUT ?? null,
              fullAllocation: process.env.BRUSH_BENCH_FULL_ALLOCATION === '1',
              visibleMasks,
              outlineThickness: Number(
                process.env.BRUSH_OUTLINE_THICKNESS ?? 1
              ),
              points,
              cycles,
              sampledCpuProfile: !!profiler,
              dataset: JHU_RETINAL_LAYERS,
              browser: browser.capabilities,
              viewport: await browser.execute(() => ({
                width: innerWidth,
                height: innerHeight,
                devicePixelRatio,
              })),
              results,
              limitations: [
                'Headless browser graphics may differ from desktop hardware.',
                'Pointer-to-animation-frame delay is a scheduling observation, not screen presentation latency.',
                'WebDriver dispatch and software rendering can dominate action completion time.',
                'Draw call wall time excludes asynchronous GPU completion.',
                'Performance.measure entries require a build from vite.brush-profile.config.ts; ordinary builds still provide browser frame and CPU observations.',
                'Instrumentation can shift source-map line positions; identify measured functions by their recorded names.',
                'Deferred-render measures include guarded calls that may draw nothing; interpret them alongside draw counts and durations.',
              ],
            },
            null,
            2
          )
        );
      });
    }
});
