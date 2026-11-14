import { volViewPage } from '../pageobjects/volview.page';
import { writeConfigImages } from './configurationImage';
import {
  openAnnotationSegments,
  segmentColor,
  segmentNames,
  segmentRow,
  waitForSegmentContent,
} from './segmentationTestUtils';
import {
  waitForModuleTransitions,
  writeManifestToFile,
  writeMetaImage,
} from './utils';

describe('Restoring a labelmap without saved segment definitions', () => {
  it('inherits definitions before matching labels on an unviewed image', async () => {
    const stem = 'mixed-segmentation-restore';
    writeMetaImage(`${stem}-source.mha`, { size: 8 });
    writeConfigImages(stem);
    await writeManifestToFile(
      {
        version: '8.0.0',
        dataSources: [
          { id: 0, type: 'uri', uri: `/tmp/${stem}-source.mha` },
          { id: 1, type: 'uri', uri: `/tmp/${stem}.nrrd` },
          { id: 2, type: 'uri', uri: `/tmp/${stem}.seg.nrrd` },
        ],
        datasets: [
          { id: 'source', dataSourceId: 0 },
          { id: 'target', dataSourceId: 1 },
        ],
        primarySelection: 'source',
        segments: [
          { id: 'matched', name: 'Matched mask', color: [255, 0, 0, 255] },
          { id: 'unused', name: 'Unused', color: [0, 255, 0, 255] },
        ],
        imageSegmentSets: [
          { imageId: 'source', segmentIds: ['matched', 'unused'] },
        ],
        segmentationArtifacts: [
          { id: 'mask', name: 'Mask', parentImage: 'target', dataSourceId: 2 },
        ],
      },
      `${stem}.json`
    );
    await volViewPage.open(`?urls=[tmp/${stem}.json]`);
    await volViewPage.waitForViews();
    await openAnnotationSegments();
    await expect(await segmentRow('Unused')).toBeDisplayed();
    await expect($('[data-testid="segment-list"]')).toHaveAttribute(
      'aria-busy',
      'false'
    );

    await $('button[data-testid="module-tab-Data"]').click();
    await waitForModuleTransitions();
    const target = $(`.image-list-card:has([title="${stem}.nrrd"])`);
    await target.waitForClickable();
    await target.click();
    await openAnnotationSegments();
    await waitForSegmentContent('Matched mask');
    expect(await segmentNames()).toEqual(['Matched mask', 'Unused']);
    expect(await segmentColor('Matched mask')).toBe('rgba(255,0,0,1)');
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });
});
