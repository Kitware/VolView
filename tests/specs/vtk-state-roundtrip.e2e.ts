import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { projectRoot } from '../e2eTestUtils';
import { makeTempDir } from './utils';

const { build } = await import(createRequire(import.meta.url).resolve('vite'));

const values = Array.from({ length: 24 }, (_, index) => (index - 12) / 8);
const geometry = {
  WholeExtent: '0 1 0 1 0 1',
  Origin: '12 -5 9',
  Spacing: '0.5 2 3',
  Direction: '0 1 0 -1 0 0 0 0 1',
};
const source = `<VTKFile type="ImageData" version="0.1" byte_order="LittleEndian">
  <ImageData ${Object.entries(geometry)
    .map(([name, value]) => `${name}="${value}"`)
    .join(' ')}>
    <Piece Extent="0 1 0 1 0 1">
      <PointData Scalars="SignedVectors">
        <DataArray type="Float32" Name="SignedVectors" NumberOfComponents="3" format="ascii">${values.join(' ')}</DataArray>
      </PointData>
      <CellData />
    </Piece>
  </ImageData>
</VTKFile>`;

function floatValues(encoded: string) {
  const blocks = Buffer.from(encoded.slice(0, 8), 'base64').readUInt32LE(0);
  const headerLength = 4 * Math.ceil(((3 + blocks) * 4) / 3);
  const header = Buffer.from(encoded.slice(0, headerLength), 'base64');
  const compressed = Buffer.from(encoded.slice(headerLength), 'base64');
  let offset = 0;
  const data = Buffer.concat(
    Array.from({ length: blocks }, (_, index) => {
      const length = header.readUInt32LE((3 + index) * 4);
      const block = inflateSync(compressed.subarray(offset, offset + length));
      offset += length;
      return block;
    })
  );
  return Array.from({ length: data.length / 4 }, (_, index) =>
    data.readFloatLE(index * 4)
  );
}

// Scalar images retain their source file on session save. Exercise their actual
// VTI reader/writer workers directly, including the public serialized output.
describe('VTI worker state round trip', () => {
  it('preserves signed multicomponent values and image geometry across export and reload', async () => {
    const directory = makeTempDir('vtk-state-roundtrip');
    writeFileSync(
      join(directory, 'index.html'),
      `<pre id="result"></pre><script type="module">
        import '@kitware/vtk.js/Common/DataModel/ImageData';
        import { vtiReader, vtiWriter } from '@/src/io/vtk/async';
        const result = document.querySelector('#result');
        try {
          const image = await vtiReader(new File([${JSON.stringify(source)}], 'signed.vti'));
          const exported = await vtiWriter(image);
          const restored = await vtiReader(new File([exported], 'restored.vti'));
          const reexported = await vtiWriter(restored);
          result.textContent = JSON.stringify({ files: [exported, reexported] });
        } catch (error) {
          result.textContent = JSON.stringify({ error: String(error) });
        }
      </script>`
    );
    await build({
      configFile: false,
      root: directory,
      base: './',
      resolve: { alias: { '@': projectRoot() } },
      build: { outDir: join(directory, 'built') },
    });
    await browser.url('/tmp/vtk-state-roundtrip/built/index.html');
    await browser.waitUntil(async () => (await $('#result').getText()) !== '');
    const result = JSON.parse(await $('#result').getText()) as {
      files: string[];
      error?: string;
    };
    expect(result.error).toBeUndefined();
    const outputs = await browser.execute((files) => {
      return files.map((xml) => {
        const document = new DOMParser().parseFromString(xml, 'text/xml');
        const image = document.querySelector('ImageData')!;
        const array = document.querySelector('PointData DataArray')!;
        return {
          geometry: Object.fromEntries(
            ['WholeExtent', 'Origin', 'Spacing', 'Direction'].map((name) => [
              name,
              image.getAttribute(name),
            ])
          ),
          type: array.getAttribute('type'),
          components: array.getAttribute('NumberOfComponents'),
          values: array.textContent!.trim(),
        };
      });
    }, result.files);
    expect(outputs).toHaveLength(2);
    for (const output of outputs) {
      expect(output.geometry).toEqual(geometry);
      expect(output.type).toBe('Float32');
      expect(output.components).toBe('3');
      expect(floatValues(output.values)).toEqual(values);
    }
  });
});
