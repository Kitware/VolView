import { describe, expect, it } from 'vitest';
import { configIo } from '../configIo';

describe('segmentation filename configuration migration', () => {
  it.each([
    [{}, ''],
    [{ segmentationExtension: 'seg' }, 'seg'],
    [{ segmentGroupExtension: 'seg' }, 'seg'],
    [{ segmentationExtension: 'seg', segmentGroupExtension: 'seg' }, 'seg'],
    [{ segmentationExtension: '' }, ''],
    [{ segmentGroupExtension: '' }, ''],
    [{ segmentationExtension: '', segmentGroupExtension: '' }, ''],
  ])('normalizes %j to one runtime field', (input, extension) => {
    expect(configIo.parse(input)).toEqual({
      layerExtension: '',
      segmentationExtension: extension,
    });
  });

  it.each([
    { segmentationExtension: 'seg', segmentGroupExtension: 'mask' },
    { segmentationExtension: '', segmentGroupExtension: 'seg' },
    { segmentationExtension: 'seg', segmentGroupExtension: '' },
  ])('rejects conflicting aliases: %j', (input) => {
    expect(() => configIo.parse(input)).toThrow(
      'io.segmentGroupExtension conflicts with io.segmentationExtension'
    );
  });

  it.each(['segmentGroupExtension', 'segmentationExtension'])(
    'rejects a non-string %s',
    (key) => {
      expect(configIo.safeParse({ [key]: null }).success).toBe(false);
      expect(configIo.safeParse({ [key]: 1 }).success).toBe(false);
    }
  );
});
