import { test, expect } from '../fixtures';

test.describe('An image with zero voxel spacing', () => {
  test('can be painted and reports the invalid spacing', async ({
    volview,
    utils,
  }) => {
    // itk-wasm passes a MetaImage's zero ElementSpacing through unchanged.
    const fileName = utils.writeMetaImage(
      `zero-voxel-spacing-${Date.now()}.mha`,
      {
        spacing: '0 1 1',
      }
    );
    const manifestName = `zero-voxel-spacing-${Date.now()}.json`;
    await utils.writeManifestToFile(
      { resources: [{ url: `/tmp/${fileName}`, name: fileName }] },
      manifestName
    );

    await volview.open(`?urls=[tmp/${manifestName}]`);
    await volview.waitForViews();
    await volview.activatePaint();
    await volview.paintStrokeOnView(volview.views2D.first());

    expect(await volview.getNotificationTitles()).toEqual([
      'Invalid voxel spacing',
    ]);
  });
});
