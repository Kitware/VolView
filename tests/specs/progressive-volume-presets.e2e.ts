import fs from 'node:fs';
import path from 'node:path';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import { buildSyntheticDicom, newUid } from './syntheticDicom';
import {
  appearance,
  openVolumeRenderingControls,
} from './volumeRenderingTestUtils';

const layout = {
  direction: 'row',
  items: [{ type: '3D', viewDirection: 'Superior', viewUp: 'Anterior' }],
};
const loadingIndicator = () => $('.volume-viewer-container .loading-indicator');
const presetCard = (name: string) => $(`[data-testid="volume-preset-${name}"]`);
let heldSlice: Awaited<ReturnType<typeof browser.addInitScript>> | undefined;

async function openStreamingVolume(
  modality: string,
  normalized = false,
  sliceCount = 8
) {
  const directory = `progressive-${modality}-${normalized}-${sliceCount}`;
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
        index === sliceCount - 1 || (sliceCount > 2 && index === 0)
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
    JSON.stringify({ resources })
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
      await expect(presetCard('Adaptive-Balanced')).toHaveAttribute(
        'aria-disabled',
        'true'
      );
      await releaseSlice();
      await expectCompletedPreset(modality === 'CT' ? 'CT-AAA' : 'MR-Default');
    });
  }

  it('displays a constant MR slice before completion and after a 3D view mounts', async () => {
    await openStreamingVolume('MR', false, 2);
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
    await openStreamingVolume('MR', true);
    await openVolumeRenderingControls();
    await expect(presetCard('Adaptive-Balanced')).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    await expect(presetCard('MR-Default')).not.toHaveElementClass('bg-blue');
    await releaseSlice();
    await expectCompletedPreset('Adaptive-Balanced');
  });

  it('preserves a preset selected while slices are loading', async () => {
    await openStreamingVolume('MR');
    await expectVisibleVolume();
    await openVolumeRenderingControls();
    const selected = presetCard('CT-AAA');
    await selected.scrollIntoView({ block: 'center', behavior: 'instant' });
    await selected.click();
    await expect(selected).toHaveElementClass('bg-blue');
    await expect(loadingIndicator()).toBeDisplayed();
    await releaseSlice();
    await expectCompletedPreset('CT-AAA');
  });
});
