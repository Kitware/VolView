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
  ] as const)('displays %s as square pixels', (raw, value) => {
    const dataset = spacingDataset(raw);

    expect(readPixelSpacing(dataset)).toEqual([value, value]);
    expect(readGeometryFacts(dataset).pixelSpacing).toBeNull();
    expect(getDatasetTag(dataset, '00280030')).toBe(raw);
  });

  it.each(['0', '-0.5', 'NaN', 'Infinity', ''])(
    'does not use %s as display spacing',
    (raw) => {
      expect(readPixelSpacing(spacingDataset(raw))).toEqual([1, 1]);
    }
  );
});
