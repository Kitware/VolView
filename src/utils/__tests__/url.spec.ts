import { parseUrl } from '@/src/utils/url';
import { describe, expect, it } from 'vitest';

describe('utils/url', () => {
  describe('parseUrl', () => {
    it('should parse a URL', () => {
      expect(parseUrl('https://example.com/path').pathname).to.equal('/path');
      expect(parseUrl('gs://bucket/').protocol).to.equal('gs:');
      expect(parseUrl('gs://bucket/path/object').pathname).to.equal(
        '/path/object'
      );
      expect(parseUrl('path/object', 'gs://bucket').protocol).to.equal('gs:');
    });
  });
});
