import { describe, expect, it } from 'vitest';
import { datasetFromTags } from '@/tests/dicomDataset';
import { readGeometryFacts } from '../../collections/instanceFacts';
import { getDatasetTag } from '../datasetAccess';
import { readPixelSpacing } from '../spatialMetadata';

const spacingDataset = (value: string) =>
  datasetFromTags([['00280030', value]]);

describe('single-value PixelSpacing display compatibility', () => {
  it.each([
    ['0.5', 0.5],
    ['0.0104', 0.0104],
    [' 2.5\u0000', 2.5],
  ] as const)(
    'displays %s as square pixels without claiming calibration',
    (raw, value) => {
      const dataset = spacingDataset(raw);
      const axes = readPixelSpacing(dataset);

      expect(axes.map((axis) => axis.value)).toEqual([value, value]);
      for (const axis of axes) {
        expect(axis).toMatchObject({
          unit: 'unknown',
          status: 'fallback',
          source: 'Single PixelSpacing value',
        });
        expect(axis.reason).toContain('square pixels are assumed for display');
      }
      expect(readGeometryFacts(dataset).pixelSpacing).toBeNull();
      expect(getDatasetTag(dataset, '00280030')).toBe(raw);
    }
  );

  it.each(['0', '-0.5', 'NaN', 'Infinity', ''])(
    'does not use %s as display spacing',
    (raw) => {
      expect(readPixelSpacing(spacingDataset(raw))).toEqual([
        expect.objectContaining({
          value: 1,
          unit: 'unknown',
          status: 'fallback',
        }),
        expect.objectContaining({
          value: 1,
          unit: 'unknown',
          status: 'fallback',
        }),
      ]);
    }
  );
});
