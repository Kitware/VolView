import { volViewPage } from '../pageobjects/volview.page';
import { writeManifestToFile, writeMetaImage } from './utils';

describe('An image with zero voxel spacing', () => {
  it('can be painted and reports the invalid spacing', async () => {
    // itk-wasm passes a MetaImage's zero ElementSpacing through unchanged.
    const fileName = writeMetaImage(`zero-voxel-spacing-${Date.now()}.mha`, {
      spacing: '0 1 1',
    });
    const manifestName = `zero-voxel-spacing-${Date.now()}.json`;
    await writeManifestToFile(
      { resources: [{ url: `/tmp/${fileName}`, name: fileName }] },
      manifestName
    );

    await volViewPage.open(`?urls=[tmp/${manifestName}]`);
    await volViewPage.waitForViews();
    await volViewPage.activatePaint();
    const views2D = await volViewPage.getViews2D();
    await volViewPage.paintStrokeOnView(views2D[0]);

    expect(await volViewPage.getNotificationTitles()).toEqual([
      'Invalid voxel spacing',
    ]);
  });
});
