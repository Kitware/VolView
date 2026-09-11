import * as fs from 'fs';
import * as path from 'path';
import { cleanuptotal } from 'wdio-cleanuptotal-service';

import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import { writeManifestToFile } from './utils';

const SIZE = 16;

// itk-wasm passes a MetaImage's zero ElementSpacing through unchanged.
function writeZeroSpacingMetaImage() {
  const fileName = `zero-voxel-spacing-${Date.now()}.mha`;
  const filePath = path.join(TEMP_DIR, fileName);
  const header = [
    'ObjectType = Image',
    'NDims = 3',
    `DimSize = ${SIZE} ${SIZE} ${SIZE}`,
    'ElementSpacing = 0 1 1',
    'ElementType = MET_UCHAR',
    'ElementDataFile = LOCAL',
    '',
  ].join('\n');
  const voxels = Uint8Array.from({ length: SIZE ** 3 }, (_, i) => i % 256);
  fs.writeFileSync(filePath, Buffer.concat([Buffer.from(header), voxels]));

  cleanuptotal.addCleanup(async () => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  return fileName;
}

const notificationTitles = async () => {
  await volViewPage.notifications.click();
  const titles = $$('.message-center .v-expansion-panel-title .header > span');
  await titles[0].waitForDisplayed();
  return titles.map((title) => title.getText());
};

describe('An image with zero voxel spacing', () => {
  it('can be painted and reports the invalid spacing', async () => {
    const fileName = writeZeroSpacingMetaImage();
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

    expect(await notificationTitles()).toEqual(['Invalid voxel spacing']);
  });
});
