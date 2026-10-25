import { describe, it, expect } from 'vitest';
import { NAME_TO_TAG, TAG_TO_NAME, Tags } from '@/src/core/dicomTags';

describe('dicomTags', () => {
  it.each([
    ['SliceThickness', '0018|0050'],
    ['SequenceName', '0018|0024'],
    ['SeriesDate', '0008|0021'],
  ])('names %s', (name, tag) => {
    expect(Tags[name]).toBe(tag);
    expect(NAME_TO_TAG.get(name)).toBe(tag);
    expect(TAG_TO_NAME.get(tag)).toBe(name);
  });
});
