import { parseContentRangeHeader } from '@/src/utils/parseContentRangeHeader';
import { describe, expect, it } from 'vitest';

describe('parseContentRangeHeader', () => {
  it('should handle valid ranges', () => {
    let range = parseContentRangeHeader('bytes 0-1/123');
    expect(range.type).toEqual('range');
    if (range.type !== 'range') return; // ts can't narrow on expect()

    expect(range.start).toEqual(0);
    expect(range.end).toEqual(1);
    expect(range.length).toEqual(123);

    range = parseContentRangeHeader('bytes 2-5/*');
    expect(range.type).toEqual('range');
    if (range.type !== 'range') return; // ts can't narrow on expect()

    expect(range.start).toEqual(2);
    expect(range.end).toEqual(5);
    expect(range.length).to.be.null;
  });

  it('should handle unsatisfied ranges', () => {
    const range = parseContentRangeHeader('bytes */12');
    expect(range.type).toEqual('unsatisfied-range');
    if (range.type !== 'unsatisfied-range') return; // ts can't narrow on expect()

    expect(range.length).toEqual(12);
  });

  it('should handle invalid ranges', () => {
    [
      '',
      'bytes',
      'bytes */*',
      'byte 0-1/2',
      'bytes 1-0/2',
      'bytes 0-1/1',
      'bytes 1-3/2',
      'bytes 1-/2',
      'bytes -1/2',
    ].forEach((range) => {
      expect(parseContentRangeHeader(range).type).toEqual('invalid-range');
    });
  });
});
