import path from 'node:path';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import {
  openThroughDialog,
  writeManifestToFile,
  writeMetaImage,
} from './utils';
import {
  addSegment,
  openAnnotationSegments,
  segmentNames,
  waitForNamedSegments,
} from './segmentationTestUtils';

const STEM = 'clear-scene-segments';

describe('Clearing the scene', () => {
  it('drops every segment the config does not declare', async () => {
    const image = writeMetaImage(`${STEM}.mha`);
    await writeManifestToFile(
      { segments: { Tumor: { color: '#ff0000' } } },
      `${STEM}-config.json`
    );
    await volViewPage.open(`?urls=[tmp/${STEM}-config.json,tmp/${image}]`);
    await volViewPage.waitForViews();
    await openAnnotationSegments();
    await waitForNamedSegments();
    await addSegment();
    await addSegment();
    expect(await segmentNames()).toEqual(['Tumor', 'Segment 1', 'Segment 2']);

    await browser.keys(['Control', '/']);
    await $('[data-testid="segment-list"]').waitForExist({ reverse: true });

    await openThroughDialog(path.join(TEMP_DIR, image));
    await openAnnotationSegments();
    await waitForNamedSegments();
    expect(await segmentNames()).toEqual(['Tumor']);
    expect(await volViewPage.getNotificationsCount()).toEqual(0);
  });
});
