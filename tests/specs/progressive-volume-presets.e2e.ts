import fs from 'node:fs';
import path from 'node:path';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import { buildSyntheticDicom, newUid } from './syntheticDicom';
import {
  appearance,
  restoredVolumeManifest,
  openVolumeRenderingControls,
} from './volumeRenderingTestUtils';

const layout = {
  direction: 'row',
  items: [{ type: '3D', viewDirection: 'Superior', viewUp: 'Anterior' }],
};
const loadingIndicator = () => $('.volume-viewer-container .loading-indicator');
const presetCard = (name: string) => $(`[data-testid="volume-preset-${name}"]`);
const presetLabel = () => $('.volume-viewer-container .view-annotations');
let heldSlice: Awaited<ReturnType<typeof browser.addInitScript>> | undefined;

async function openStreamingVolume(
  modality: string,
  {
    normalized = false,
    sliceCount = 8,
    finalPixelValue = 0,
    restoreColoring = false,
  } = {}
) {
  const directory = `progressive-${modality}-${normalized}-${sliceCount}-${finalPixelValue}`;
  const folder = path.join(TEMP_DIR, directory);
  fs.mkdirSync(folder, { recursive: true });
  const studyUid = newUid();
  const seriesUid = newUid();
  const rows = 24;
  const cols = 24;
  let headerLength = 0;
  const resources = Array.from({ length: sliceCount }, (_, index) => {
    const name = `slice-${index}.dcm`;
    const bytes = buildSyntheticDicom({
      studyUid,
      seriesUid,
      sopUid: newUid(),
      modality,
      instanceNumber: index + 1,
      rows,
      cols,
      imageOrientationPatient: [1, 0, 0, 0, 1, 0],
      imagePositionPatient: [0, 0, index * 3],
      spacingBetweenSlices: 3,
      pixelValue:
        index === sliceCount - 1
          ? finalPixelValue
          : sliceCount > 2 && index === 0
            ? 0
            : 200 + index * 50,
      ...(normalized ? { rescaleSlope: 0.001 } : {}),
    });
    fs.writeFileSync(path.join(folder, name), bytes);
    headerLength = bytes.length - rows * cols * 2;
    return { url: `tmp/${directory}/${name}`, name };
  });
  const manifest = `${directory}.json`;
  const config = `${directory}-layout.json`;
  // Keep fixtures until the runner removes TEMP_DIR, including after failures
  // that release the outstanding request from this spec's afterEach hook.
  fs.writeFileSync(
    path.join(TEMP_DIR, manifest),
    JSON.stringify(
      restoreColoring
        ? restoredVolumeManifest(resources, {
            preset: 'Adaptive-Balanced',
            mappingRange: [250, 1000],
          })
        : { resources }
    )
  );
  fs.writeFileSync(
    path.join(TEMP_DIR, config),
    JSON.stringify({ layouts: { default: layout } })
  );

  // Let the ordinary URI loader read every slice's metadata. Keep one slice's
  // pixel request outstanding until the test explicitly releases it.
  heldSlice = await browser.addInitScript(
    ({ pathname, prefixLength }) => {
      const original = window.fetch.bind(window);
      const released = new Promise<void>((resolve) => {
        window.addEventListener('release-volume-slice', () => resolve(), {
          once: true,
        });
      });
      window.fetch = async (input, init) => {
        const request = new Request(input, init);
        if (new URL(request.url).pathname !== pathname)
          return original(input, init);
        if (request.headers.has('range')) {
          await released;
          return original(input, init);
        }
        const response = await original(input, init);
        const bytes = new Uint8Array(await response.arrayBuffer());
        return new Response(bytes.slice(0, prefixLength), {
          status: response.status,
          headers: response.headers,
        });
      };
    },
    {
      pathname: `/tmp/${directory}/slice-${sliceCount - 1}.dcm`,
      prefixLength: headerLength,
    }
  );
  await volViewPage.open(`?urls=[tmp/${config},tmp/${manifest}]`);
  await volViewPage.waitForViewCounts(0, true);
  await expect(loadingIndicator()).toBeDisplayed();
}

async function switchViewType(name: string, count2D: number, has3D: boolean) {
  await $('.view-type-select').click();
  const option = $(`[role="option"]*=${name}`);
  await option.waitForClickable();
  await option.click();
  await volViewPage.waitForViewCounts(count2D, has3D);
}

async function releaseSlice() {
  await browser.execute(() => {
    window.dispatchEvent(new Event('release-volume-slice'));
  });
}

async function expectVisibleVolume() {
  await browser.waitUntil(async () => (await appearance()).visible > 180, {
    timeoutMsg: 'Expected decoded DICOM slices to be visible in the 3D view',
  });
}

async function expectCompletedPreset(preset: string) {
  await expect(loadingIndicator()).not.toExist();
  await expect(presetCard(preset)).toHaveElementClass('bg-blue');
  await expect(presetLabel()).toHaveText(
    expect.stringContaining(preset.replace(/-/g, ' '))
  );
  await expectVisibleVolume();
  expect(await volViewPage.getNotificationsCount()).toBe(0);
}

describe('progressive volume presets', () => {
  afterEach(async () => {
    await releaseSlice();
    await heldSlice?.remove();
    heldSlice = undefined;
  });

  for (const modality of ['CT', 'MR']) {
    it(`displays partial ${modality} data before the final slice loads`, async () => {
      await openStreamingVolume(modality);
      await expectVisibleVolume();
      await expect(loadingIndicator()).toBeDisplayed();
      await openVolumeRenderingControls();
      const preset = modality === 'CT' ? 'CT-AAA' : 'MR-Default';
      await expect(presetCard(preset)).toHaveElementClass('bg-blue');
      await expect(presetLabel()).toHaveText(
        expect.stringContaining(preset.replace(/-/g, ' '))
      );
      const cinematic = $('[data-testid="volume-properties"]');
      await cinematic.scrollIntoView({ block: 'center', behavior: 'instant' });
      await expect(cinematic).toBeDisplayed();
      await expect(cinematic.$('.v-slider input')).toBeDisabled();
      await expect(cinematic.$('.v-switch input')).toBeDisabled();
      await cinematic.moveTo();
      const tooltipID = await cinematic.getAttribute('aria-describedby');
      if (!tooltipID) throw new Error('Expected a Cinematic loading tooltip');
      const loadingTooltip = $(`#${tooltipID}`);
      await expect(loadingTooltip).toBeDisplayed();
      await expect(loadingTooltip).toHaveText(
        expect.stringContaining('after the volume finishes loading')
      );
      await expect(presetCard('Adaptive-Balanced')).toHaveAttribute(
        'aria-disabled',
        'true'
      );
      await releaseSlice();
      await expectCompletedPreset(preset);
      await expect(cinematic.$('.v-slider input')).toBeEnabled();
      await expect(cinematic.$('.v-switch input')).toBeEnabled();
    });
  }

  it('displays a constant MR slice before completion and after a 3D view mounts', async () => {
    await openStreamingVolume('MR', { sliceCount: 2 });
    await expectVisibleVolume();
    await switchViewType('Axial', 1, false);
    await switchViewType('Volume', 0, true);
    await expect(loadingIndicator()).toBeDisplayed();
    await expectVisibleVolume();
    await openVolumeRenderingControls();
    await releaseSlice();
    await expectCompletedPreset('MR-Default');
  });

  it('fits normalized MR data only after all slices load', async () => {
    await openStreamingVolume('MR', { normalized: true });
    await openVolumeRenderingControls();
    await expect(presetCard('Adaptive-Balanced')).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    await expect(presetCard('MR-Default')).toHaveElementClass('bg-blue');
    await expect(presetLabel()).toHaveText(
      expect.stringContaining('MR Default')
    );
    await releaseSlice();
    await expectCompletedPreset('Adaptive-Balanced');
  });

  it('preserves a selected preset and finishes its opacity range when the final slice expands the intensities', async () => {
    await openStreamingVolume('MR', { finalPixelValue: 2000 });
    await expectVisibleVolume();
    await openVolumeRenderingControls();
    const selected = presetCard('CT-AAA');
    await selected.scrollIntoView({ block: 'center', behavior: 'instant' });
    await selected.click();
    await expect(selected).toHaveElementClass('bg-blue');
    await expect(loadingIndicator()).toBeDisplayed();
    await releaseSlice();
    await expectCompletedPreset('CT-AAA');
    await expect(
      $('[data-testid="volume-reset-color-opacity"]')
    ).toBeDisabled();
  });

  it('updates restored adaptive Shift bounds when the final slice expands the intensities', async () => {
    await openStreamingVolume('MR', {
      finalPixelValue: 2000,
      restoreColoring: true,
    });
    await openVolumeRenderingControls();
    await expect(presetCard('Adaptive-Balanced')).toHaveElementClass('bg-blue');
    await expect(presetLabel()).toHaveText(
      expect.stringContaining('Adaptive Balanced')
    );
    await releaseSlice();
    await expect(loadingIndicator()).not.toExist();
    const shift = $('[data-testid="volume-color-shift"] [role="slider"]');
    const width = $('[data-testid="volume-color-width"] [role="slider"]');
    await expect(width).toHaveAttribute('aria-valuenow', '750');
    // Seven equally sized nonzero slices have median 400 and upper fit 2000.
    // The restored color center is 625, so its shift from the new fit is -575.
    await expect(shift).toHaveAttribute('aria-valuenow', '-575');
    await shift.scrollIntoView({ block: 'center', behavior: 'instant' });
    await shift.execute((element) => element.focus());
    await browser.keys('ArrowRight');
    await expect(shift).toHaveAttribute('aria-valuenow', '-574');
    await expect(width).toHaveAttribute('aria-valuenow', '750');
    await browser.keys('ArrowLeft');
    await expect(shift).toHaveAttribute('aria-valuenow', '-575');
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });
});
