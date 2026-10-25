import { describe, expect, it } from 'vitest';
import { readDicomTags } from '@/src/io/readDicomTags';
import { readDicomTagsOffThread } from '@/src/io/readDicomTagsOffThread';
import { buildSlice } from './readDicomTagsFixtures';

// The test DOM has no Worker, so this covers the in-place path only; the
// worker path is the same reader behind a message.
describe('readDicomTagsOffThread', () => {
  it('reads what the reader reads', async () => {
    const bytes = buildSlice({ patientName: 'DOE^JOHN' });

    expect(await readDicomTagsOffThread(bytes)).toEqual(readDicomTags(bytes));
  });

  it('reads a view that does not own its buffer', async () => {
    const whole = buildSlice();
    const padded = new Uint8Array(whole.length + 3);
    padded.set(whole, 3);

    expect(await readDicomTagsOffThread(padded.subarray(3))).toEqual(
      readDicomTags(whole)
    );
  });

  it('rejects what the reader rejects', async () => {
    await expect(
      readDicomTagsOffThread(new Uint8Array(256).fill(0x41))
    ).rejects.toThrow(/Not DICOM/);
  });
});
