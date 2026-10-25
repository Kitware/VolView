import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { Tags } from '@/src/core/dicomTags';
import type { DataSource } from '@/src/io/import/dataSource';
import { fileToDataSource } from '@/src/io/import/dataSource';
import handleDicom from '@/src/io/import/processors/handleDicom';
import { FILE_EXT_TO_MIME } from '@/src/io/mimeTypes';
import { readDicomTags } from '@/src/io/readDicomTags';
import { Skip } from '@/src/utils/evaluateChain';
import { useMessageStore } from '@/src/store/messages';
import { stripFileMeta, stripPreamble } from '@/tests/specs/syntheticDicom';
import {
  bytesFetcher,
  dicomFile,
  syntheticSlice,
  withoutPixelData,
} from '@/src/core/streaming/dicom/__tests__/dicomSourceFixtures';

const REGION = { physicalDeltaX: 0.0625, physicalDeltaY: 0.125 };

const fileSource = (bytes: Uint8Array, name = 'slice.dcm'): DataSource =>
  fileToDataSource(dicomFile(bytes, name));

const uriSource = (bytes: Uint8Array, name = 'slice.dcm'): DataSource => ({
  type: 'uri',
  uri: `https://example.com/${name}`,
  name,
  mime: FILE_EXT_TO_MIME.dcm,
  fetcher: bytesFetcher(bytes),
});

const kinds = [
  { kind: 'file', source: fileSource },
  { kind: 'uri', source: uriSource },
] as const;

const chunkOf = (result: unknown) => {
  const intermediate = result as { type: string; dataSources: DataSource[] };
  expect(intermediate.type).toBe('intermediate');
  expect(intermediate.dataSources).toHaveLength(1);
  const [chunkSource] = intermediate.dataSources;
  if (chunkSource.type !== 'chunk') throw new Error('expected a chunk source');
  return chunkSource;
};

describe('handleDicom', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it.each(kinds)('emits a chunk for a $kind source', async ({ source }) => {
    const bytes = syntheticSlice({ patientName: 'DOE^JOHN' });

    const chunkSource = chunkOf(await handleDicom(source(bytes)));

    expect(chunkSource.mime).toBe(FILE_EXT_TO_MIME.dcm);
    expect(chunkSource.chunk.metadata).toEqual(readDicomTags(bytes));
  });

  it.each(kinds)(
    'reads a $kind source that has no preamble without comment',
    async ({ source }) => {
      const bytes = syntheticSlice({ patientName: 'DOE^JOHN' });

      const chunkSource = chunkOf(
        await handleDicom(source(stripPreamble(bytes), 'bare.dcm'))
      );

      expect(chunkSource.chunk.metadata).toEqual(readDicomTags(bytes));
      expect(useMessageStore().messages).toHaveLength(0);
    }
  );

  it('reads a bare data set and says once that its syntax was assumed', async () => {
    const bytes = syntheticSlice({ patientName: 'DOE^JOHN' });
    const bare = stripFileMeta(bytes);

    const first = chunkOf(await handleDicom(fileSource(bare, 'first.dcm')));
    const second = chunkOf(await handleDicom(fileSource(bare, 'second.dcm')));

    expect(first.chunk.metadata).toEqual(readDicomTags(bytes));
    expect(second.chunk.metadata).toEqual(readDicomTags(bytes));
    const { messages } = useMessageStore();
    expect(messages).toHaveLength(1);
    expect(messages[0].title).toContain('no file meta information');
    expect(messages[0].options.details).toContain('first.dcm');
    expect(messages[0].options.details).toContain('Explicit VR Little Endian');
  });

  it('reads the same metadata from a file and from a uri', async () => {
    const bytes = syntheticSlice({ patientName: 'DOE^JOHN', modality: 'CT' });

    const fromFile = chunkOf(await handleDicom(fileSource(bytes)));
    const fromUri = chunkOf(await handleDicom(uriSource(bytes)));

    expect(fromFile.chunk.metadata).toEqual(fromUri.chunk.metadata);
  });

  it.each(kinds)(
    'keeps the whole $kind source as the chunk data',
    async ({ source }) => {
      const bytes = syntheticSlice();

      const chunkSource = chunkOf(await handleDicom(source(bytes)));
      await chunkSource.chunk.loadData();

      const data = chunkSource.chunk.dataBlob;
      expect(data).toBeTruthy();
      expect(new Uint8Array(await data!.arrayBuffer())).toEqual(bytes);
    }
  );

  it.each(kinds)(
    'carries ultrasound regions on a $kind source',
    async ({ source }) => {
      const bytes = syntheticSlice({
        modality: 'US',
        ultrasoundRegion: REGION,
      });

      const chunkSource = chunkOf(await handleDicom(source(bytes)));

      expect(chunkSource.chunk.ultrasoundRegions?.regionCount).toBe(1);
      expect(
        chunkSource.chunk.ultrasoundRegions?.region?.physicalDeltaX
      ).toBeCloseTo(REGION.physicalDeltaX);
      expect(
        chunkSource.chunk.ultrasoundRegions?.region?.physicalDeltaY
      ).toBeCloseTo(REGION.physicalDeltaY);
    }
  );

  it.each(kinds)(
    'skips an RT modality on a $kind source and warns',
    async ({ source, kind }) => {
      const name = `rt-${kind}.dcm`;
      const bytes = withoutPixelData(syntheticSlice({ modality: 'RTSTRUCT' }));

      const result = await handleDicom(source(bytes, name));

      expect(result).toEqual({
        type: 'ok',
        dataSource: expect.objectContaining({ type: kind }),
      });
      const [warning] = useMessageStore().messages;
      expect(warning.title).toContain('RTSTRUCT');
      expect(warning.title).toContain(name);
    }
  );

  it('does not skip a non-RT modality whose name starts with R', async () => {
    const bytes = syntheticSlice({ modality: 'RG' });

    const chunkSource = chunkOf(await handleDicom(fileSource(bytes)));

    expect(Object.fromEntries(chunkSource.chunk.metadata!)[Tags.Modality]).toBe(
      'RG'
    );
    expect(useMessageStore().messages).toHaveLength(0);
  });

  it('skips a file source that is not DICOM', async () => {
    const source: DataSource = {
      type: 'file',
      file: new File([new Uint8Array(4)], 'volume.nrrd', {
        type: FILE_EXT_TO_MIME.nrrd,
      }),
      fileType: FILE_EXT_TO_MIME.nrrd,
    };

    expect(await handleDicom(source)).toBe(Skip);
  });

  it('skips a uri source that is not DICOM', async () => {
    const source: DataSource = {
      type: 'uri',
      uri: 'https://example.com/volume.nrrd',
      name: 'volume.nrrd',
      mime: FILE_EXT_TO_MIME.nrrd,
    };

    expect(await handleDicom(source)).toBe(Skip);
  });

  it.each(kinds)(
    'names the $kind source when its bytes are not DICOM',
    async ({ source }) => {
      const broken = source(new Uint8Array(512), 'broken.dcm');

      await expect(handleDicom(broken)).rejects.toThrow(/broken\.dcm/);
    }
  );
});
