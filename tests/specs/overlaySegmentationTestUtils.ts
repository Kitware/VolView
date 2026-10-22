import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import {
  openAnnotationSegments,
  waitForSegmentContent,
} from './segmentationTestUtils';
import {
  selectLayout,
  waitForModuleTransitions,
  writeManifestToFile,
} from './utils';

const writeImages = (prefix: string) => {
  const header = [
    'NRRD0005',
    'type: unsigned char',
    'dimension: 3',
    'sizes: 16 16 16',
    'space: left-posterior-superior',
    'space directions: (1,0,0) (0,1,0) (0,0,1)',
    'space origin: (0,0,0)',
    'encoding: ascii',
  ];
  // The viewed plane is white underneath a black overlay. The corner voxel
  // preserves a nonzero scalar range without appearing on that plane.
  for (const [name, value] of [
    [`${prefix}-base.nrrd`, 255],
    [`${prefix}-base.layer.nrrd`, 0],
  ] as const) {
    const pixels = Array.from({ length: 4096 }, (_, i) =>
      i === 0 ? 255 - value : value
    ).join(' ');
    writeFileSync(join(TEMP_DIR, name), `${header.join('\n')}\n\n${pixels}`);
  }
  const mask = Array.from({ length: 4096 }, (_, index) => {
    const i = index % 16;
    const j = Math.floor(index / 16) % 16;
    const k = Math.floor(index / 256);
    return i >= 4 && i <= 11 && j >= 4 && j <= 11 && k >= 4 && k <= 11 ? 1 : 0;
  }).join(' ');
  writeFileSync(
    join(TEMP_DIR, `${prefix}-base.seg.nrrd`),
    `${header.join('\n')}\nSegment0_LabelValue:=1\nSegment0_Name:=Blue mask\nSegment0_Color:=0 0 1\n\n${mask}`
  );
};

export const openOverlaySegmentationFixture = async (prefix: string) => {
  writeImages(prefix);
  await writeManifestToFile(
    {
      io: { segmentationExtension: 'seg', layerExtension: 'layer' },
      windowing: { width: 255, level: 127.5 },
    },
    `${prefix}-config.json`
  );
  await volViewPage.open(
    `?urls=[tmp/${prefix}-config.json,tmp/${prefix}-base.nrrd,tmp/${prefix}-base.seg.nrrd,tmp/${prefix}-base.layer.nrrd]`
  );
  await volViewPage.waitForViews();
  await selectLayout('Axial Only', 1, false);
  await openAnnotationSegments();
  await waitForSegmentContent('Blue mask');
  await volViewPage.renderingModuleTab.click();
  await waitForModuleTransitions();
  const transparent = $('[data-testid="layer-transparent-background"] input');
  await expect(transparent).toBeChecked();
  await transparent.scrollIntoView({ block: 'center', behavior: 'instant' });
  await transparent.execute((element) => element.focus());
  await browser.keys('Space');
  await expect(transparent).not.toBeChecked();
};
