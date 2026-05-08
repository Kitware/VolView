import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isAmazonS3Uri,
  extractBucketAndPrefixFromS3Uri,
  getObjectsFromS3,
} from '@/src/io/amazonS3';

const xmlListResponse = (
  keys: string[],
  { isTruncated = false, nextToken = '' } = {}
) => `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <IsTruncated>${isTruncated}</IsTruncated>
  ${nextToken ? `<NextContinuationToken>${nextToken}</NextContinuationToken>` : ''}
  ${keys.map((k) => `<Contents><Key>${k}</Key><Size>1</Size></Contents>`).join('\n')}
</ListBucketResult>`;

const okResponse = (body: string) =>
  new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/xml' },
  });

const errorResponse = (status: number) => new Response('', { status });

describe('amazonS3', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('isAmazonS3Uri', () => {
    it('detects s3:// uris', () => {
      expect(isAmazonS3Uri('s3://bucket/key')).toBe(true);
      expect(isAmazonS3Uri('https://example.com')).toBe(false);
    });
  });

  describe('extractBucketAndPrefixFromS3Uri', () => {
    it('extracts bucket and prefix', () => {
      expect(
        extractBucketAndPrefixFromS3Uri('s3://my-bucket/some/prefix')
      ).toEqual(['my-bucket', 'some/prefix']);
    });

    it('handles bucket-only uri', () => {
      expect(extractBucketAndPrefixFromS3Uri('s3://my-bucket/')).toEqual([
        'my-bucket',
        '',
      ]);
    });
  });

  describe('getObjectsFromS3', () => {
    it('lists objects via plain fetch (no SDK headers)', async () => {
      fetchSpy.mockResolvedValueOnce(
        okResponse(xmlListResponse(['a.dcm', 'b.dcm']))
      );

      const seen: Array<[string, string]> = [];
      await getObjectsFromS3('s3://bucket/prefix', (name, url) =>
        seen.push([name, url])
      );

      expect(seen).toEqual([
        ['a.dcm', 'https://bucket.s3.amazonaws.com/a.dcm'],
        ['b.dcm', 'https://bucket.s3.amazonaws.com/b.dcm'],
      ]);

      // Confirm no custom headers were attached (the bug we fixed)
      const [, init] = fetchSpy.mock.calls[0];
      expect(init).toBeUndefined();
    });

    it('percent-encodes reserved chars in keys but preserves slashes', async () => {
      fetchSpy.mockResolvedValueOnce(
        okResponse(
          xmlListResponse([
            'scan?1.dcm',
            'seg#1.dcm',
            'my scan.dcm',
            'a+b.dcm',
            'sub/dir/file.dcm',
          ])
        )
      );

      const urls: string[] = [];
      await getObjectsFromS3('s3://bucket/prefix', (_name, url) =>
        urls.push(url)
      );

      expect(urls).toEqual([
        'https://bucket.s3.amazonaws.com/scan%3F1.dcm',
        'https://bucket.s3.amazonaws.com/seg%231.dcm',
        'https://bucket.s3.amazonaws.com/my%20scan.dcm',
        'https://bucket.s3.amazonaws.com/a%2Bb.dcm',
        'https://bucket.s3.amazonaws.com/sub/dir/file.dcm',
      ]);
    });

    it('follows pagination via continuation token', async () => {
      fetchSpy
        .mockResolvedValueOnce(
          okResponse(
            xmlListResponse(['a.dcm'], { isTruncated: true, nextToken: 'TOK' })
          )
        )
        .mockResolvedValueOnce(okResponse(xmlListResponse(['b.dcm'])));

      const keys: string[] = [];
      await getObjectsFromS3('s3://bucket/prefix', (name) => keys.push(name));

      expect(keys).toEqual(['a.dcm', 'b.dcm']);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls[1][0]).toContain('continuation-token=TOK');
    });

    it('throws when no objects are returned', async () => {
      fetchSpy.mockResolvedValueOnce(okResponse(xmlListResponse([])));
      await expect(getObjectsFromS3('s3://bucket/missing')).rejects.toThrow(
        'no objects'
      );
    });

    it('throws on unexpected XML root (not ListBucketResult or Error)', async () => {
      fetchSpy.mockResolvedValueOnce(
        okResponse('<?xml version="1.0"?><html><body/></html>')
      );
      await expect(getObjectsFromS3('s3://bucket/prefix')).rejects.toThrow(
        /unexpected response root/
      );
    });

    it('retries on transient 5xx and succeeds', async () => {
      vi.useFakeTimers();
      fetchSpy
        .mockResolvedValueOnce(errorResponse(503))
        .mockResolvedValueOnce(okResponse(xmlListResponse(['ok.dcm'])));

      const promise = getObjectsFromS3('s3://bucket/prefix');
      await vi.runAllTimersAsync();
      await promise;

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });

    it('does not retry on 4xx (other than 408/429)', async () => {
      fetchSpy.mockResolvedValueOnce(errorResponse(403));
      await expect(getObjectsFromS3('s3://bucket/prefix')).rejects.toThrow(
        /HTTP 403/
      );
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('gives up after MAX_ATTEMPTS retryable failures', async () => {
      vi.useFakeTimers();
      fetchSpy.mockResolvedValue(errorResponse(503));

      const promise = getObjectsFromS3('s3://bucket/prefix');
      const expectation = expect(promise).rejects.toThrow();
      await vi.runAllTimersAsync();
      await expectation;

      expect(fetchSpy).toHaveBeenCalledTimes(3);
      vi.useRealTimers();
    });
  });
});
