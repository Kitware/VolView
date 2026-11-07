import { describe, expect, it, vi } from 'vitest';
import { readDicomDataset } from '@/packages/dicom/core/metadata/dicomDataset';
import { Tags } from '@/packages/dicom/core/metadata/dicomTags';
import { blobFetcher } from '@/packages/dicom/core/streaming/blobFetcher';
import { CachedStreamFetcher } from '@/packages/dicom/core/streaming/cachedStreamFetcher';
import { DicomMetaLoader } from '@/packages/dicom/core/streaming/dicom/dicomMetaLoader';
import { dicomMetadataForDisplay } from '../octMetadata';
import { OCT_GEOMETRY_ERROR, OCT_SCAN_PATTERN } from '../octMetadataTags';
import {
  createSyntheticOCT,
  element,
  enhancedFile,
  sequence,
} from '@/tests/fixtures/oct/dicom';
import { deflatedExplicitVR } from '@/tests/fixtures/oct/volumes';

const positions = (values: number[]) =>
  values.map((z) => ({ position: `0\\0\\${z}` }));

describe('structured OCT application metadata', () => {
  it.each([
    ['regular', [0, 0.2, 0.4], undefined],
    ['reversed', [0.4, 0.2, 0], /image grid/],
    ['uneven', [0, 0.1, 0.4], /nonuniform/],
  ] as const)(
    'retains the existing %s geometry policy without changing raw data',
    async (_, z, error) => {
      const file = enhancedFile(positions([...z]));
      const dataset = readDicomDataset(
        new Uint8Array(await file.arrayBuffer())
      );
      const before = structuredClone(dataset);
      const projected = new Map(dicomMetadataForDisplay(dataset));
      if (error) expect(projected.get(OCT_GEOMETRY_ERROR)).toMatch(error);
      else {
        expect(projected.has(OCT_GEOMETRY_ERROR)).toBe(false);
        expect(projected.get(Tags.ImagePositionPatient)).toBe('0\\0\\0');
        expect(projected.get(Tags.SpacingBetweenSlices)).toBe('0.2');
      }
      expect(dataset).toEqual(before);
    }
  );

  it.each(['128280', '128282'])(
    'retains nested B-scan pattern %s and volumetric restrictions',
    async (pattern) => {
      const file = enhancedFile(positions([0, 0.2]), [
        element('00221622', 'CS', 'NO'),
        sequence('00221640', [
          sequence('00221618', [element('00080100', 'SH', pattern)]),
        ]),
      ]);
      const dataset = readDicomDataset(
        new Uint8Array(await file.arrayBuffer())
      );
      const projected = new Map(dicomMetadataForDisplay(dataset));

      expect(projected.get(OCT_SCAN_PATTERN)).toBe(pattern);
      expect(projected.get(Tags.OphthalmicVolumetricPropertiesFlag)).toBe('NO');
      expect(projected.get(OCT_GEOMETRY_ERROR)).toBeUndefined();
    }
  );

  it('preserves shared-only geometry with declared spacing without inventing frame positions', async () => {
    const file = enhancedFile([], [element('00180088', 'DS', '0.2')]);
    const dataset = readDicomDataset(new Uint8Array(await file.arrayBuffer()));
    const count = dataset.elements.find((entry) => entry.tag === '00280008')!;
    count.values = { kind: 'decimal', values: [3], text: ['3'] };
    const projected = new Map(dicomMetadataForDisplay(dataset));

    expect(projected.get(Tags.PixelSpacing)).toBe('0.01\\0.02');
    expect(projected.get(Tags.SpacingBetweenSlices)).toBe('0.2');
    expect(projected.has(Tags.ImagePositionPatient)).toBe(false);
    expect(projected.has(OCT_GEOMETRY_ERROR)).toBe(false);
  });

  it.each([false, true])(
    'matches file and HTTP OCT metadata after loading, deflated=%s',
    async (deflated) => {
      const original = new Uint8Array(createSyntheticOCT());
      const bytes = deflated ? deflatedExplicitVR(original) : original;
      const file = new File([bytes], 'oct.dcm');
      const fetch = vi.fn(
        async () =>
          new Response(bytes, {
            headers: { 'Content-Length': String(bytes.length) },
          })
      );
      const loaders = [
        new DicomMetaLoader(blobFetcher(file)),
        new DicomMetaLoader(
          new CachedStreamFetcher('https://example.test/oct.dcm', { fetch })
        ),
      ];
      try {
        await Promise.all(loaders.map((loader) => loader.load()));
        const projected = loaders.map(
          (loader) => new Map(dicomMetadataForDisplay(loader.meta!))
        );
        expect(projected[0]).toEqual(projected[1]);
        expect(projected[0].get(OCT_SCAN_PATTERN)).toBe('128280');
        expect(projected[0].has(OCT_GEOMETRY_ERROR)).toBe(false);
        expect(projected[0].get(Tags.PixelSpacing)).toBe('0.0104\\0.046875');
        expect(fetch).toHaveBeenCalledTimes(1);
      } finally {
        loaders.forEach((loader) => loader.dispose());
      }
    }
  );
});
