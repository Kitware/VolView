import { volViewPage } from '../pageobjects/volview.page';
import { openUrls, writeManifestToFile } from './utils';

describe('VolView windowing configuration', () => {
  it('should use runtime config window level over DICOM window level', async () => {
    const runtimeWindowLevel = {
      width: 2000,
      level: 1000,
    };

    const config = {
      windowing: runtimeWindowLevel,
    };

    const configFileName = 'windowing-config.json';
    await writeManifestToFile(config, configFileName);

    const manifest = {
      resources: [
        { url: `/tmp/${configFileName}` },
        {
          url: 'https://data.kitware.com/api/v1/file/6566aa81c5a2b36857ad1783/download/CT000085.dcm',
          name: 'CT000085.dcm',
        },
      ],
    };

    const manifestFileName = 'windowing-manifest.json';
    await writeManifestToFile(manifest, manifestFileName);

    await volViewPage.open(`?urls=[tmp/${manifestFileName}]`);
    await volViewPage.waitForViews();

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
    await openUrls([
      {
        url: 'https://data.kitware.com/api/v1/file/6566aa81c5a2b36857ad1783/download/CT000085.dcm',
        name: 'CT000085.dcm',
      },
    ]);

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
    await openUrls([
      {
        url: 'https://data.kitware.com/api/v1/file/68e9807dbf0f869935e36481/download/minimal.dcm',
        name: 'minimal.dcm',
      },
    ]);

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
