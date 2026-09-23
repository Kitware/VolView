import * as fs from 'fs';
import * as path from 'path';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import { createRasterFixture } from './rasterThumbnailFixtures';
import { writeManifestToFile } from './utils';

type RGB = [number, number, number];

async function openImages(names: string[], manifestName: string) {
  for (const name of names) {
    fs.writeFileSync(path.join(TEMP_DIR, name), createRasterFixture(name));
  }
  await writeManifestToFile(
    { resources: names.map((name) => ({ url: `/tmp/${name}`, name })) },
    manifestName
  );
  await volViewPage.open(`?urls=[tmp/${manifestName}]`);
}

async function thumbnailPixels(name: string, points: [number, number][]) {
  await browser.waitUntil(
    () =>
      browser.execute((imageName) => {
        const card = Array.from(
          document.querySelectorAll('.image-list-card')
        ).find((element) => element.textContent?.includes(imageName));
        const image = card?.querySelector('img');
        return (
          image instanceof HTMLImageElement &&
          image.complete &&
          image.naturalWidth > 0
        );
      }, name),
    { timeoutMsg: `Expected a rendered thumbnail for ${name}` }
  );

  return browser.execute(
    (imageName, locations) => {
      const card = Array.from(
        document.querySelectorAll('.image-list-card')
      ).find((element) => element.textContent?.includes(imageName));
      const image = card?.querySelector('img') as HTMLImageElement;
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return locations.map(
        ([x, y]) =>
          Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3)) as RGB
      );
    },
    name,
    points
  );
}

describe('raster image thumbnails', () => {
  it('shows RGB PNG and JPEG colors and a grayscale gradient', async () => {
    const names = [
      'rgb-thumbnail.png',
      'rgb-thumbnail.jpg',
      'gray-thumbnail.png',
    ];
    await openImages(names, 'raster-thumbnail-manifest.json');
    const expected: RGB[] = [
      [128, 64, 64],
      [64, 128, 64],
      [192, 32, 64],
      [32, 192, 64],
    ];
    for (const name of names.slice(0, 2)) {
      const colors = (await thumbnailPixels(name, [
        [25, 25],
        [75, 25],
        [25, 75],
        [75, 75],
      ])) as RGB[];
      for (let pixel = 0; pixel < expected.length; pixel += 1) {
        for (let channel = 0; channel < 3; channel += 1) {
          expect(
            Math.abs(colors[pixel][channel] - expected[pixel][channel])
          ).toBeLessThan(16);
        }
      }
    }

    const [dark, light] = await thumbnailPixels(names[2], [
      [15, 50],
      [85, 50],
    ]);
    expect(dark[0]).toBeLessThan(80);
    expect(light[0]).toBeGreaterThan(170);
  });

  it('composites RGBA pixels into the displayed thumbnail', async () => {
    const name = 'rgba-thumbnail.png';
    await openImages([name], 'rgba-thumbnail-manifest.json');
    const [opaque, partial, transparent, yellow] = (await thumbnailPixels(
      name,
      [
        [25, 25],
        [75, 25],
        [25, 75],
        [75, 75],
      ]
    )) as RGB[];

    expect(opaque[0]).toBeGreaterThan(200);
    expect(opaque[1]).toBeLessThan(50);
    expect(opaque[2]).toBeLessThan(50);
    expect(partial[0]).toBeLessThan(30);
    expect(partial[1]).toBeGreaterThan(100);
    expect(partial[1]).toBeLessThan(160);
    expect(partial[2]).toBeLessThan(30);
    expect(transparent.every((channel) => channel < 30)).toBe(true);
    expect(yellow[0]).toBeGreaterThan(200);
    expect(yellow[1]).toBeGreaterThan(200);
    expect(yellow[2]).toBeLessThan(50);
  });
});
