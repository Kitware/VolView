import { describe, it, expect } from 'vitest';
import { normalizeUrlParams } from './urlParams';

describe('normalizeUrlParams', () => {
  it('handles single URL as string', () => {
    const result = normalizeUrlParams({
      urls: 'https://example.com/file.dcm',
    });
    expect(result.urls).toEqual(['https://example.com/file.dcm']);
  });

  it('handles array of URLs', () => {
    const result = normalizeUrlParams({
      urls: ['https://example.com/file1.dcm', 'https://example.com/file2.dcm'],
    });
    expect(result.urls).toEqual([
      'https://example.com/file1.dcm',
      'https://example.com/file2.dcm',
    ]);
  });

  it('handles bracket notation string', () => {
    const result = normalizeUrlParams({
      urls: '[https://example.com/file1.dcm,https://example.com/file2.dcm]',
    });
    expect(result.urls).toEqual([
      'https://example.com/file1.dcm',
      'https://example.com/file2.dcm',
    ]);
  });

  it('handles comma-separated URLs', () => {
    const result = normalizeUrlParams({
      urls: 'https://example.com/file1.dcm,https://example.com/file2.dcm',
    });
    expect(result.urls).toEqual([
      'https://example.com/file1.dcm',
      'https://example.com/file2.dcm',
    ]);
  });

  it('filters out invalid URLs', () => {
    const result = normalizeUrlParams({
      urls: ['https://example.com/valid.dcm', 'not-a-url', 'also-invalid'],
    });
    expect(result.urls).toEqual(['https://example.com/valid.dcm']);
  });

  it('handles URLs with query parameters', () => {
    const result = normalizeUrlParams({
      urls: 'https://api.example.com/getImage?id=123&format=dcm',
    });
    expect(result.urls).toEqual([
      'https://api.example.com/getImage?id=123&format=dcm',
    ]);
  });

  it('handles config and names parameters', () => {
    const result = normalizeUrlParams({
      config: 'https://example.com/config.json',
      names: ['Image 1', 'Image 2'],
    });
    expect(result.config).toEqual(['https://example.com/config.json']);
    expect(result.names).toEqual(['Image 1', 'Image 2']);
  });

  it('returns empty object for no valid URLs', () => {
    const result = normalizeUrlParams({
      urls: 'not-a-url',
    });
    expect(result.urls).toBeUndefined();
  });

  it('handles save parameter', () => {
    const result = normalizeUrlParams({
      save: 'https://example.com/save',
    });
    expect(result.save).toBe('https://example.com/save');
  });

  it('preserves save parameter as array', () => {
    const result = normalizeUrlParams({
      save: ['https://example.com/save1', 'https://example.com/save2'],
    });
    expect(result.save).toEqual([
      'https://example.com/save1',
      'https://example.com/save2',
    ]);
  });
});
