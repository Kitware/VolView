import * as fs from 'node:fs';
import * as path from 'node:path';
import JSZip from 'jszip';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import {
  openVolViewPage,
  writeManifestToFile,
  waitForDownload,
  SESSION_SAVE_TIMEOUT,
} from './utils';
import {
  openAnnotationSegments,
  segmentNames,
  selectedSegmentName,
  waitForSegmentContent,
} from './segmentationTestUtils';

const expectRestoredRegions = async () => {
  await openAnnotationSegments();
  await browser.waitUntil(async () =>
    (await segmentNames()).includes('Left region')
  );
  await waitForSegmentContent('Left region');
  await waitForSegmentContent('Right region');
  expect(await segmentNames()).toEqual(['Right region', 'Left region']);
  expect(await selectedSegmentName()).toBe('Left region');
};

const writeVolume = (name: string, mask: boolean) => {
  const header =
    'NRRD0005\ntype: unsigned char\ndimension: 3\nspace: left-posterior-superior\nsizes: 8 8 8\nspace directions: (1,0,0) (0,1,0) (0,0,1)\nspace origin: (0,0,0)\nencoding: raw\n\n';
  const voxels = Buffer.from(
    Array.from({ length: 512 }, (_, index) => {
      const x = index % 8;
      return mask ? (x === 2 ? 3 : x === 5 ? 7 : 0) : index % 256;
    })
  );
  fs.writeFileSync(
    path.join(TEMP_DIR, name),
    Buffer.concat([Buffer.from(header), voxels])
  );
};

const catalog = [
  {
    id: 'left',
    name: 'Left region',
    color: [255, 0, 0, 255],
    visible: true,
    locked: false,
  },
  {
    id: 'right',
    name: 'Right region',
    color: [0, 255, 0, 255],
    visible: true,
    locked: false,
  },
];
const provenance = {
  providerId: 'test-provider',
  jobId: 'test-job',
  outputId: 'labels',
};

for (const legacy of [false, true]) {
  describe(`${legacy ? 'Legacy group' : 'Composed labelmap'} import round trip`, () => {
    it('restores mask content, order and selection, then saves independent mask files', async () => {
      writeVolume('import-parent.nrrd', false);
      writeVolume('import-labels.nrrd', true);
      const dataSources = [
        { id: 1, type: 'uri', uri: '/tmp/import-parent.nrrd' },
        { id: 2, type: 'uri', uri: '/tmp/import-labels.nrrd' },
        { id: 3, type: 'collection', sources: [2] },
      ];
      const manifest = legacy
        ? {
            version: '6.4.0',
            dataSources,
            datasets: [{ id: 'parent', dataSourceId: 1 }],
            segmentGroups: [
              {
                id: 'labels',
                dataSourceId: 3,
                metadata: {
                  parentImage: 'parent',
                  name: 'Regions',
                  source: provenance,
                  segments: {
                    order: [7, 3],
                    byValue: {
                      '3': { value: 3, ...catalog[0] },
                      '7': { value: 7, ...catalog[1] },
                    },
                  },
                },
              },
            ],
            tools: {
              paint: { activeSegmentGroupID: 'labels', activeSegment: 3 },
            },
          }
        : {
            version: '7.0.0',
            dataSources,
            datasets: [{ id: 'parent', dataSourceId: 1 }],
            segments: [catalog[1], catalog[0]],
            selectedSegment: 'left',
            segmentations: [
              {
                id: 'segmentation',
                name: 'Regions',
                parentImage: 'parent',
                order: ['right', 'left'],
                masks: catalog.map((segment, index) => ({
                  id: segment.id,
                  segmentId: segment.id,
                  representations: {
                    labelmap: {
                      artifactId: 'labels',
                      sourceValue: index === 0 ? 3 : 7,
                      extent: [0, -1, 0, -1, 0, -1],
                    },
                  },
                })),
              },
            ],
            segmentationArtifacts: [
              {
                id: 'labels',
                parentImage: 'parent',
                name: 'Regions',
                dataSourceId: 3,
                source: provenance,
              },
            ],
          };
      const fileName = `labelmap-import-${legacy}.volview.json`;
      await writeManifestToFile(manifest, fileName);
      await openVolViewPage(fileName);
      await expectRestoredRegions();

      const savedName = await volViewPage.saveSession();
      const savedPath = path.join(TEMP_DIR, savedName);
      await waitForDownload(savedPath, SESSION_SAVE_TIMEOUT);
      const zip = await JSZip.loadAsync(fs.readFileSync(savedPath));
      const saved = JSON.parse(
        await zip.file('manifest.json')!.async('string')
      );
      expect(saved.segmentationArtifacts).toBeUndefined();
      const bindings = saved.segmentations.flatMap((segmentation: any) =>
        segmentation.masks.map((mask: any) => mask.representations.labelmap)
      );
      expect(bindings).toHaveLength(2);
      expect(new Set(bindings.map((binding: any) => binding.path)).size).toBe(
        2
      );
      for (const binding of bindings) {
        expect(binding.artifactId).toBeUndefined();
        expect(binding.source).toEqual(provenance);
        expect(zip.file(binding.path)).not.toBeNull();
      }
      await openVolViewPage(savedName);
      await expectRestoredRegions();
    });
  });
}
