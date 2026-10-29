import fs from 'node:fs';
import path from 'node:path';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import {
  createVolumeScalars,
  openVolumeRenderingControls,
} from './volumeRenderingTestUtils';
import { buildSyntheticDicom, newUid } from './syntheticDicom';
import { makeTempDir, writeManifestToFile } from './utils';

const layout = {
  direction: 'row',
  items: [{ type: '3D', viewDirection: 'Superior', viewUp: 'Anterior' }],
};

// Header metadata and intensity encoding vary independently. The geometry is
// fixed so a selected default must produce visible voxels, not just a card.
function writeVolume(
  name: string,
  type: 'float' | 'ushort' | 'short',
  low: number,
  high: number,
  metadata: Record<string, string>
) {
  const size = 32;
  const encoding =
    type === 'ushort' ? 'uint16' : type === 'short' ? 'int16' : 'float';
  const voxels = createVolumeScalars(size, encoding, (x, y, z) => {
    const radius =
      ((x - 15.5) ** 2 + (y - 15.5) ** 2 + (z - 15.5) ** 2) / 12 ** 2;
    const value =
      radius < 1 ? low + (high - low) * (0.35 + 0.65 * (1 - radius)) : low;
    return type === 'float' ? value : Math.round(value);
  });
  const header = [
    'NRRD0005',
    `type: ${type}`,
    'dimension: 3',
    `sizes: ${size} ${size} ${size}`,
    'space: left-posterior-superior',
    'space directions: (1,0,0) (0,1,0) (0,0,1)',
    'space origin: (0,0,0)',
    'encoding: raw',
    'endian: little',
    ...Object.entries(metadata).map(([key, value]) => `${key}:=${value}`),
    '',
    '',
  ].join('\n');
  fs.writeFileSync(
    path.join(TEMP_DIR, name),
    Buffer.concat([Buffer.from(header), voxels])
  );
  return name;
}

async function expectInitialPreset(preset: string) {
  await volViewPage.waitForViewCounts(0, true);
  await openVolumeRenderingControls();
  await expect($(`[data-testid="volume-preset-${preset}"]`)).toHaveElementClass(
    'bg-blue'
  );
  await browser.waitUntil(
    async () => {
      const count = await $('[data-testid~="vtk-volume-view"] canvas').execute(
        (element) => {
          const source = element as HTMLCanvasElement;
          const copy = document.createElement('canvas');
          copy.width = 64;
          copy.height = 64;
          const context = copy.getContext('2d')!;
          context.drawImage(
            source,
            source.width * 0.15,
            source.height * 0.15,
            source.width * 0.7,
            source.height * 0.7,
            0,
            0,
            64,
            64
          );
          const data = context.getImageData(0, 0, 64, 64).data;
          let visible = 0;
          for (let index = 0; index < data.length; index += 4)
            if (Math.max(data[index], data[index + 1], data[index + 2]) > 25)
              visible++;
          return visible;
        }
      );
      return Number(count) > 80;
    },
    {
      timeoutMsg: `Expected ${preset} to display the generated volume without manual contrast changes`,
    }
  );
  expect(await volViewPage.getNotificationsCount()).toBe(0);
}

async function openGeneratedVolume(name: string) {
  const config = `default-layout-${name}.json`;
  await writeManifestToFile({ layouts: { default: layout } }, config);
  await volViewPage.open(`?urls=[tmp/${config},tmp/${name}]`);
}

const cases = [
  {
    name: 'unclassified-float',
    type: 'float',
    low: 0,
    high: 1,
    metadata: {},
    preset: 'Adaptive-Balanced',
  },
  {
    name: 'unclassified-uint16',
    type: 'ushort',
    low: 0,
    high: 52000,
    metadata: {},
    preset: 'Adaptive-Balanced',
  },
  {
    name: 'CT-MR-US-OCT-without-metadata',
    type: 'short',
    low: -1000,
    high: 1500,
    metadata: {},
    preset: 'Adaptive-Balanced',
  },
  {
    name: 'declared-CT',
    type: 'short',
    low: -1000,
    high: 1500,
    metadata: { modality: 'CT' },
    preset: 'CT-AAA',
  },
  {
    name: 'declared-MR',
    type: 'ushort',
    low: 0,
    high: 1000,
    metadata: { '0008|0060': 'MR' },
    preset: 'MR-Default',
  },
  {
    name: 'declared-US',
    type: 'ushort',
    low: 0,
    high: 255,
    metadata: { Modality: 'US' },
    preset: 'US-Fetal',
  },
  {
    name: 'normalized-MR',
    type: 'float',
    low: 0,
    high: 1,
    metadata: { modality: 'MR' },
    preset: 'Adaptive-Balanced',
  },
  {
    name: 'normalized-CT',
    type: 'float',
    low: 0,
    high: 1,
    metadata: { modality: 'CT' },
    preset: 'Adaptive-Balanced',
  },
  {
    name: 'explicit-HU',
    type: 'short',
    low: -1000,
    high: 1500,
    metadata: { IntensityUnits: 'HU' },
    preset: 'CT-AAA',
  },
  {
    name: 'unknown-modality-with-HU',
    type: 'short',
    low: -1000,
    high: 1500,
    metadata: { modality: 'OT', IntensityUnits: 'HU' },
    preset: 'Adaptive-Balanced',
  },
] as const;

describe('initial volume presets', () => {
  for (const entry of cases) {
    it(`uses ${entry.preset} for ${entry.name}`, async () => {
      const name = writeVolume(
        `${entry.name}.nrrd`,
        entry.type,
        entry.low,
        entry.high,
        entry.metadata
      );
      await openGeneratedVolume(name);
      await expectInitialPreset(entry.preset);
    });
  }

  for (const modality of ['CT', 'MR']) {
    it(`uses the native DICOM ${modality} modality`, async () => {
      const directory = `default-native-${modality}`;
      const folder = makeTempDir(directory);
      const studyUid = newUid();
      const seriesUid = newUid();
      const resources = Array.from({ length: 8 }, (_, index) => {
        const name = `slice-${index}.dcm`;
        fs.writeFileSync(
          path.join(folder, name),
          buildSyntheticDicom({
            studyUid,
            seriesUid,
            sopUid: newUid(),
            modality,
            instanceNumber: index + 1,
            rows: 24,
            cols: 24,
            imageOrientationPatient: [1, 0, 0, 0, 1, 0],
            imagePositionPatient: [0, 0, index * 3],
            spacingBetweenSlices: 3,
            pixelValue: index === 0 || index === 7 ? 0 : 200 + index * 50,
          })
        );
        return { url: `tmp/${directory}/${name}`, name };
      });
      const manifest = `${directory}.json`;
      const config = `${directory}-layout.json`;
      await writeManifestToFile({ resources }, manifest);
      await writeManifestToFile({ layouts: { default: layout } }, config);
      await volViewPage.open(`?urls=[tmp/${config},tmp/${manifest}]`);
      await expectInitialPreset(modality === 'CT' ? 'CT-AAA' : 'MR-Default');
    });
  }

  it('honors an explicit manifest palette and mapping instead of the metadata default', async () => {
    const name = writeVolume('manifest-MR.nrrd', 'ushort', 0, 1000, {
      modality: 'MR',
    });
    const manifest = 'explicit-volume-preset.json';
    await writeManifestToFile(
      {
        version: '7.0.0',
        dataSources: [{ id: 0, type: 'uri', uri: `/tmp/${name}` }],
        primarySelection: '0',
        activeView: 'volume',
        layoutSlots: ['volume'],
        layout: { direction: 'row', items: [{ type: 'slot', slotIndex: 0 }] },
        viewByID: {
          volume: {
            id: 'volume',
            name: 'Volume',
            type: '3D',
            dataID: '0',
            options: { viewDirection: 'Superior', viewUp: 'Anterior' },
            config: {
              '0': {
                volumeColorConfig: {
                  colorBy: { arrayName: 'Scalars', location: 'pointData' },
                  transferFunction: {
                    preset: 'Adaptive-Transparent',
                    mappingRange: [0, 1000],
                  },
                  opacityFunction: {
                    mode: 0,
                    mappingRange: [0, 1000],
                    gaussians: [
                      {
                        position: 1,
                        height: 0.4,
                        width: 1,
                        xBias: 0,
                        yBias: 1,
                      },
                    ],
                  },
                  cvr: {
                    enabled: true,
                    lightFollowsCamera: true,
                    volumeQuality: 1,
                    useVolumetricScatteringBlending: false,
                    volumetricScatteringBlending: 0.5,
                    useLocalAmbientOcclusion: false,
                    laoKernelSize: 15,
                    laoKernelRadius: 5,
                    ambient: 0.6,
                    diffuse: 0.4,
                    specular: 0.1,
                  },
                },
              },
            },
          },
        },
      },
      manifest
    );
    await volViewPage.open(`?urls=[tmp/${manifest}]`);
    await expectInitialPreset('Adaptive-Transparent');
    await expect(
      $('[data-testid="volume-color-width"] [role="slider"]')
    ).toHaveAttribute('aria-valuenow', '1000');
  });
});
