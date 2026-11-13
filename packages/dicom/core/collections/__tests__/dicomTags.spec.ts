import { describe, it, expect } from 'vitest';
import { Tags } from '../../metadata/dicomTags';

describe('dicomTags', () => {
  it.each([
    ['SliceThickness', '0018|0050'],
    ['SequenceName', '0018|0024'],
    ['SeriesDate', '0008|0021'],
  ])('names %s', (name, tag) => {
    expect(Tags[name]).toBe(tag);
  });
});
