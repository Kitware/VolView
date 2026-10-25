import { volViewPage } from '../pageobjects/volview.page';
import { openUrls } from './utils';
import { openConfigAndDataset } from './configTestUtils';
import { ONE_CT_SLICE_DICOM, MINIMAL_DICOM } from '../datasets';

const expectWindowLevel = async (width: number, level: number) => {
  const view = $('div[data-testid="vtk-view vtk-two-view"]');
  await volViewPage.waitForLoadingIndicator(view);
  await expect(view.$('.view-annotations')).toHaveText(
    expect.stringContaining(`W/L: ${width.toFixed(2)} / ${level.toFixed(2)}`)
  );
};

describe('VolView windowing configuration', () => {
  it('should use runtime config window level over DICOM window level', async () => {
    const runtimeWindowLevel = {
      width: 2000,
      level: 1000,
    };

    const config = {
      windowing: runtimeWindowLevel,
    };

    await openConfigAndDataset(config, 'windowing');
    await expectWindowLevel(runtimeWindowLevel.width, runtimeWindowLevel.level);
  });

  it('should use DICOM window level when no runtime config is provided', async () => {
    await openUrls([ONE_CT_SLICE_DICOM]);
    await expectWindowLevel(410, 70);
  });

  it('should use auto windowing for DICOM without window/level metadata', async () => {
    await openUrls([MINIMAL_DICOM]);
    await expectWindowLevel(1900, 1050);
  });
});
