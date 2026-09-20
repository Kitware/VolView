import { makeMaskArchivePath } from '@/src/io/state-file/maskArchivePath';
import { describe, expect, it } from 'vitest';

describe('io/state-file/maskArchivePath', () => {
  describe('makeMaskArchivePath', () => {
    it('uses a sanitized mask filename stem in the archive path', () => {
      const usedPaths = new Set<string>();

      expect(
        makeMaskArchivePath('Liver: left/right*?', 'vti', usedPaths)
      ).to.equal('segmentations/Liver left right.vti');
    });

    it('deduplicates colliding sanitized names case-insensitively', () => {
      const usedPaths = new Set<string>();

      expect(makeMaskArchivePath('Liver/Left', 'vti', usedPaths)).to.equal(
        'segmentations/Liver Left.vti'
      );
      expect(makeMaskArchivePath('liver:left', 'vti', usedPaths)).to.equal(
        'segmentations/liver left (2).vti'
      );
    });
  });
});
