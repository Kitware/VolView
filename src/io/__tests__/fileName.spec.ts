import { DEFAULT_FILE_STEM, sanitizeFileStem } from '@/src/io/fileName';
import { describe, expect, it } from 'vitest';

describe('io/fileName', () => {
  describe('sanitizeFileStem', () => {
    it('replaces invalid filename characters with readable spacing', () => {
      expect(sanitizeFileStem('Liver: left/right*?')).to.equal(
        'Liver left right'
      );
    });

    it('collapses repeated whitespace and trims trailing dots and spaces', () => {
      expect(sanitizeFileStem('  Liver    left.   ')).to.equal('Liver left');
    });

    it('handles reserved Windows filenames', () => {
      expect(sanitizeFileStem('CON')).to.equal('CON_');
    });

    it('falls back when the sanitized stem would be empty', () => {
      expect(sanitizeFileStem('  ..../\\\\****   ')).to.equal(
        DEFAULT_FILE_STEM
      );
    });

    it('preserves already-valid names', () => {
      expect(sanitizeFileStem('Prostate Segmentation')).to.equal(
        'Prostate Segmentation'
      );
    });
  });
});
