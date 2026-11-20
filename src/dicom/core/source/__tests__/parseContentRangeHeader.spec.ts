import { parseContentRangeHeader } from '../parseContentRangeHeader';
import { describe, expect, it } from 'vitest';

describe('parseContentRangeHeader', () => {
  it.each([
    ['bytes 0-1/123', { type: 'range', start: 0, end: 1, length: 123 }],
    ['bytes 2-5/*', { type: 'range', start: 2, end: 5, length: null }],
  ])('reads %s', (header, range) => {
    expect(parseContentRangeHeader(header)).toEqual(range);
  });

  it.each([
    '',
    'bytes',
    'bytes */12',
    'bytes */*',
    'byte 0-1/2',
    'bytes 1-0/2',
    'bytes 0-1/1',
    'bytes 1-3/2',
    'bytes 1-/2',
    'bytes -1/2',
  ])('rejects %j', (header) => {
    expect(parseContentRangeHeader(header)).toEqual({ type: 'invalid-range' });
  });
});
