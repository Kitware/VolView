import { volViewPage } from '../pageobjects/volview.page';
import { openUrls } from './utils';
import {
  openConfigAndDataset,
  ONE_CT_SLICE_DICOM,
  MINIMAL_DICOM,
} from './configTestUtils';

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

    const view = await $('div[data-testid="vtk-view vtk-two-view"]');

    await volViewPage.waitForLoadingIndicator(view);

    const viewAnnotations = await view.$('.view-annotations');
    const wlText = await viewAnnotations.getText();

    const match = wlText.match(/W\/L:\s*([\d.]+)\s*\/\s*([\d.]+)/);
    expect(match).not.toBeNull();

    const displayedWidth = parseFloat(match![1]);
    const displayedLevel = parseFloat(match![2]);

    expect(displayedWidth).toBe(runtimeWindowLevel.width);
    expect(displayedLevel).toBe(runtimeWindowLevel.level);
  });

  it('should use DICOM window level when no runtime config is provided', async () => {
    await openUrls([ONE_CT_SLICE_DICOM]);

    const view = await $('div[data-testid="vtk-view vtk-two-view"]');

    await volViewPage.waitForLoadingIndicator(view);

    const viewAnnotations = await view.$('.view-annotations');
    const wlText = await viewAnnotations.getText();

    const match = wlText.match(/W\/L:\s*([\d.]+)\s*\/\s*([\d.]+)/);
    expect(match).not.toBeNull();

    const displayedWidth = parseFloat(match![1]);
    const displayedLevel = parseFloat(match![2]);

    expect(displayedWidth).toBe(410);
    expect(displayedLevel).toBe(70);
  });

  it('should use auto windowing for DICOM without window/level metadata', async () => {
    await openUrls([MINIMAL_DICOM]);

    const view = await $('div[data-testid="vtk-view vtk-two-view"]');

    await volViewPage.waitForLoadingIndicator(view);

    const viewAnnotations = await view.$('.view-annotations');
    const wlText = await viewAnnotations.getText();

    const match = wlText.match(/W\/L:\s*([\d.]+)\s*\/\s*([\d.]+)/);
    expect(match).not.toBeNull();

    const displayedWidth = parseFloat(match![1]);
    const displayedLevel = parseFloat(match![2]);

    expect(displayedWidth).toBe(1900);
    expect(displayedLevel).toBe(1050);
  });
});
