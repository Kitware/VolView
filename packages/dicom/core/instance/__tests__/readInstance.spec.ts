import { describe, expect, it } from 'vitest';
import { readInstance } from '../readInstance';
import { getDatasetTag } from '../../metadata/datasetAccess';
import {
  pixelDataStart,
  syntheticSlice,
  withoutPixelData,
} from '@/tests/dicomSourceFixtures';
import { rawElement } from '@/tests/specs/syntheticDicom';
import { trackedSource } from '../../source/__tests__/sourceFixtures';

const PATIENT_NAME = '00100010';
const CHUNK = 256;

const largeSlice = (modality = 'MR') =>
  syntheticSlice({
    rows: 64,
    cols: 64,
    modality,
    patientName: 'DOE^JANE',
    extraElements: [
      rawElement(0x0029, 0x0010, 'LO', new TextEncoder().encode('VENDOR')),
    ],
  });

const signal = () => new AbortController().signal;

describe('readInstance', () => {
  it('reads the public header and where Pixel Data starts', async () => {
    const bytes = largeSlice();
    const { source } = trackedSource(bytes, CHUNK);

    const instance = await readInstance(source, signal());

    expect(instance.source).toBe(source);
    expect(getDatasetTag(instance.dataset, PATIENT_NAME)).toBe('DOE^JANE');
    expect(
      instance.dataset.elements.some((element) => element.group === 0x0029)
    ).toBe(false);
    const start = pixelDataStart(bytes);
    expect(instance.pixelData).toEqual({
      offset: start,
      valueOffset: start + 12,
      length: bytes.length - start - 12,
    });
    expect(instance.transferSyntaxUid).toBe('1.2.840.10008.1.2.1');
    expect(instance.layout).toMatchObject({ preamble: true, fileMeta: true });
    expect(instance.ultrasoundRegions).toBeNull();
    expect(Object.isFrozen(instance)).toBe(true);
  });

  it('stops pulling bytes at the header and cancels the stream', async () => {
    const bytes = largeSlice();
    const { source, stats } = trackedSource(bytes, CHUNK);

    await readInstance(source, signal());

    expect(stats.cancelled).toBe(1);
    expect(stats.delivered).toBeLessThanOrEqual(
      pixelDataStart(bytes) + 2 * CHUNK
    );
    expect(stats.delivered).toBeLessThan(bytes.length / 2);
  });

  it('reads an object without Pixel Data to its last byte', async () => {
    const bytes = withoutPixelData(largeSlice());
    const { source, stats } = trackedSource(bytes, CHUNK);

    const instance = await readInstance(source, signal());

    expect(instance.pixelData).toBeNull();
    expect(getDatasetTag(instance.dataset, PATIENT_NAME)).toBe('DOE^JANE');
    expect(stats.delivered).toBe(bytes.length);
  });

  it('returns after the Modality tag of an RT object only when asked to', async () => {
    const bytes = largeSlice('RTDOSE');
    const skipped = trackedSource(bytes, CHUNK);
    const complete = trackedSource(bytes, CHUNK);

    const shortcut = await readInstance(skipped.source, signal(), {
      imageImportPolicy: 'skip-radiotherapy',
    });
    const full = await readInstance(complete.source, signal());

    expect(shortcut.pixelData).toBeNull();
    expect(getDatasetTag(shortcut.dataset, PATIENT_NAME)).toBeUndefined();
    expect(full.pixelData?.offset).toBe(pixelDataStart(bytes));
    expect(skipped.stats.delivered).toBeLessThan(complete.stats.delivered);
  });

  it('reads nothing once its signal has aborted', async () => {
    const { source, stats } = trackedSource(largeSlice(), CHUNK);
    const controller = new AbortController();
    controller.abort(new DOMException('stop', 'AbortError'));

    await expect(readInstance(source, controller.signal)).rejects.toMatchObject(
      { name: 'AbortError' }
    );
    expect(stats.reads).toBe(0);
  });
});
