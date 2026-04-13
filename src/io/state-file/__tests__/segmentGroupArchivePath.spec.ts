import { makeSegmentGroupArchivePath } from '@/src/io/state-file/segmentGroupArchivePath';
import { describe, expect, it } from 'vitest';

describe('io/state-file/segmentGroupArchivePath', () => {
  describe('makeSegmentGroupArchivePath', () => {
    it('uses a sanitized segment group stem in the archive path', () => {
      const usedPaths = new Set<string>();

      expect(
        makeSegmentGroupArchivePath('Liver: left/right*?', 'vti', usedPaths)
      ).to.equal('labels/Liver left right.vti');
    });

    it('deduplicates colliding sanitized names case-insensitively', () => {
      const usedPaths = new Set<string>();

      expect(
        makeSegmentGroupArchivePath('Liver/Left', 'vti', usedPaths)
      ).to.equal('labels/Liver Left.vti');
      expect(
        makeSegmentGroupArchivePath('liver:left', 'vti', usedPaths)
      ).to.equal('labels/liver left (2).vti');
    });
  });
});
