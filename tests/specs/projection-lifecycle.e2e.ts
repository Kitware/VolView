import fs from 'node:fs';
import path from 'node:path';
import { createSyntheticOCT } from '../fixtures/oct/dicom';
import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import { makeTempDir, writeManifestToFile } from './utils';
import {
  canvasAppearance,
  displayedWindow,
  enFacePixel,
  expandEnFaceSection,
  waitForEnFaceReady,
} from './octTestUtils';

const CANVAS = '[data-testid="oct-en-face-canvas"]';
const VIEWER = '[data-testid="oct-en-face-viewer"]';
const SOURCE = 'div[data-testid~="vtk-two-view"]';
const WINDOW_TOOL = 'button[data-testid^="control-button-Window & Level "]';

type WorkerMode = 'normal' | 'hold' | 'fail';
type WorkerRecord = {
  id: number;
  mode: WorkerMode;
  method: string | null;
  received: boolean;
  terminated: boolean;
};
type LifecycleWindow = Window & {
  projectionLifecycle: {
    nextMode: WorkerMode;
    workers: WorkerRecord[];
    release(id: number): void;
    errors: string[];
  };
};

async function installWorkerBoundary() {
  await browser.addInitScript(() => {
    const deliveries = new Map<number, () => void>();
    const probe: LifecycleWindow['projectionLifecycle'] = {
      nextMode: 'normal',
      workers: [],
      errors: [],
      release(id) {
        const deliver = deliveries.get(id);
        if (!deliver) throw new Error('No completed projection for ' + id);
        deliveries.delete(id);
        deliver();
      },
    };
    (window as unknown as LifecycleWindow).projectionLifecycle = probe;
    window.addEventListener('error', (event) =>
      probe.errors.push(event.message)
    );
    window.addEventListener('unhandledrejection', (event) =>
      probe.errors.push(String(event.reason))
    );
    window.Worker = new Proxy(window.Worker, {
      construct(target, args) {
        if (!String(args[0]).includes('projection.worker'))
          return Reflect.construct(target, args);
        const mode = probe.nextMode;
        probe.nextMode = 'normal';
        const record: WorkerRecord = {
          id: probe.workers.length + 1,
          mode,
          method: null,
          received: false,
          terminated: false,
        };
        probe.workers.push(record);
        const errorURL =
          mode === 'fail'
            ? URL.createObjectURL(
                new Blob(['throw new Error("Controlled projection failure")'], {
                  type: 'text/javascript',
                })
              )
            : null;
        const worker = Reflect.construct(target, [
          errorURL ?? args[0],
          args[1],
        ]) as Worker;
        if (mode === 'fail')
          worker.addEventListener('error', (event) => event.preventDefault());
        let onmessage: Worker['onmessage'] = null;
        const proxy = new Proxy(worker, {
          get(current, property) {
            if (property === 'onmessage') return onmessage;
            if (property === 'terminate')
              return () => {
                record.terminated = true;
                if (errorURL) URL.revokeObjectURL(errorURL);
                current.terminate();
              };
            if (property === 'postMessage')
              return (message: { method?: string }) => {
                record.method = message.method ?? null;
                current.postMessage(message);
              };
            const value = Reflect.get(current, property, current);
            return typeof value === 'function' ? value.bind(current) : value;
          },
          set(current, property, value) {
            if (property === 'onmessage') {
              onmessage = value;
              return true;
            }
            return Reflect.set(current, property, value, current);
          },
        });
        worker.addEventListener('message', (event) => {
          record.received = true;
          const callback = onmessage;
          const deliver = () => callback?.call(proxy, event);
          if (mode === 'hold') deliveries.set(record.id, deliver);
          else deliver();
        });
        return proxy;
      },
    });
  });
}

async function chooseMethod(label: string, mode: WorkerMode) {
  await browser.execute((next) => {
    (window as unknown as LifecycleWindow).projectionLifecycle.nextMode = next;
  }, mode);
  await $('[data-testid="oct-en-face-controls"]').click();
  await expandEnFaceSection('projection');
  const select = $('[data-testid="oct-projection-method"]');
  await select.scrollIntoView({ block: 'center', inline: 'nearest' });
  await select.waitForClickable();
  await select.click();
  const option = $(
    '//div[contains(@class,"v-overlay--active")]//div[contains(@class,"v-list-item") and normalize-space(.)="' +
      label +
      '"]'
  );
  await option.waitForClickable();
  await option.click();
  await option.waitForDisplayed({ reverse: true });
  await browser.keys('Escape');
  await $('[data-testid="oct-rendering-panel"]').waitForDisplayed({
    reverse: true,
  });
}

async function completedHeldWorker(method: string) {
  let workerId = 0;
  await browser.waitUntil(async () => {
    workerId = await browser.execute((expected) => {
      const workers = (window as unknown as LifecycleWindow).projectionLifecycle
        .workers;
      return (
        workers.findLast(
          (worker) =>
            worker.method === expected &&
            worker.mode === 'hold' &&
            worker.received &&
            !worker.terminated
        )?.id ?? 0
      );
    }, method);
    return workerId > 0;
  });
  return workerId;
}

async function releaseWorker(id: number) {
  await browser.execute((workerId) => {
    (window as unknown as LifecycleWindow).projectionLifecycle.release(
      workerId
    );
  }, id);
}

async function canvasFingerprint(selector: string) {
  return canvasAppearance(await $(selector).getElement());
}

async function expectPendingBlank() {
  await expect($(VIEWER)).toHaveAttribute('aria-busy', 'true');
  await expect($('[data-testid="oct-slice-lines"]')).not.toExist();
  await browser.waitUntil(
    async () => (await canvasFingerprint(CANVAS)).visiblePixels === 0
  );
}

async function expectProjectionGray(gray: number) {
  await browser.waitUntil(async () => {
    const pixel = await enFacePixel(60, 12);
    return (
      pixel[3] === 255 &&
      pixel.slice(0, 3).every((channel) => Math.abs(channel - gray) <= 1)
    );
  });
}

describe('Projection worker lifecycle', () => {
  before(installWorkerBoundary);

  it('clears pending pixels, rejects obsolete delivery, retries failure and releases a pending view', async () => {
    const directory = makeTempDir('projection-lifecycle');
    fs.writeFileSync(path.join(directory, 'retina.dcm'), createSyntheticOCT());
    await writeManifestToFile(
      { layouts: { 'Projection lifecycle': [['axial'], ['enface']] } },
      'projection-lifecycle.json'
    );
    await volViewPage.open(
      '?urls=[tmp/projection-lifecycle.json,tmp/projection-lifecycle/retina.dcm]'
    );
    await volViewPage.waitForViews();
    await waitForEnFaceReady();
    await browser.waitUntil(
      async () =>
        (await canvasFingerprint(SOURCE + ' canvas')).visiblePixels > 100
    );
    const sourcePixels = await canvasFingerprint(SOURCE + ' canvas');
    const sourceWindow = await displayedWindow(await $(SOURCE).getElement());

    await $(CANVAS).click();
    await $(WINDOW_TOOL).click();
    const inputs = $$('.v-overlay--active .manual-inputs input');
    await inputs[0].waitForDisplayed();
    await inputs[0].waitForStable();
    await setValueVueInput(inputs[0], '1000');
    await setValueVueInput(inputs[1], '500');
    await browser.keys('Escape');
    await inputs[0].waitForDisplayed({ reverse: true });
    await expectProjectionGray(81);

    await chooseMethod('Maximum', 'hold');
    const obsolete = await completedHeldWorker('max');
    await expectPendingBlank();
    await chooseMethod('Sum', 'hold');
    const current = await completedHeldWorker('sum');
    await expectPendingBlank();
    await releaseWorker(obsolete);
    await expectPendingBlank();
    await releaseWorker(current);
    await waitForEnFaceReady();
    await expectProjectionGray(255);

    await chooseMethod('Mean', 'fail');
    const status = $('[data-testid="oct-projection-status"]');
    await expect(status).toHaveText(
      expect.stringContaining('Controlled projection failure')
    );
    await expect($(VIEWER)).toHaveAttribute('aria-busy', 'false');
    await expect($('[data-testid="oct-slice-lines"]')).not.toExist();
    await browser.waitUntil(
      async () => (await canvasFingerprint(CANVAS)).visiblePixels === 0
    );
    const retry = status.$('button=Retry projection');
    await retry.waitForClickable();
    await retry.click();
    await waitForEnFaceReady();
    await expectProjectionGray(81);

    await chooseMethod('Maximum', 'hold');
    const unmounted = await completedHeldWorker('max');
    await expectPendingBlank();
    await $(VIEWER + ' .view-type-select .v-field').click();
    const axial = $(
      '//div[contains(@class,"v-overlay--active")]//div[contains(@class,"v-list-item") and normalize-space(.)="Axial"]'
    );
    await axial.waitForClickable();
    await axial.click();
    await expect($(VIEWER)).not.toExist();
    expect(
      await browser.execute((workerId) => {
        return (
          window as unknown as LifecycleWindow
        ).projectionLifecycle.workers.find((worker) => worker.id === workerId)!
          .terminated;
      }, unmounted)
    ).toBe(true);
    await releaseWorker(unmounted);
    await expect($(VIEWER)).not.toExist();
    expect(await displayedWindow(await $(SOURCE).getElement())).toEqual(
      sourceWindow
    );
    expect(await canvasFingerprint(SOURCE + ' canvas')).toEqual(sourcePixels);
    expect(
      await browser.execute(
        () => (window as unknown as LifecycleWindow).projectionLifecycle.errors
      )
    ).toEqual([]);
  });
});
