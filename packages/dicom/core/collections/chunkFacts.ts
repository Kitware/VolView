import type { Chunk } from '../streaming/chunk';
import type { DicomDataset } from '../metadata/dicomDataset';
import { readInstanceDetails } from './instanceFacts';

type ChunkFacts = {
  metadata: DicomDataset;
  details: ReturnType<typeof readInstanceDetails>;
};

// Chunk metadata is immutable after loading. Weak keys release derived facts
// with the source; standalone dataset readers remain uncached.
const factsByChunk = new WeakMap<Chunk, ChunkFacts>();

export function readChunkFacts(chunk: Chunk) {
  const { metadata } = chunk;
  if (!metadata) throw new Error('DICOM chunk metadata has not been read');
  const cached = factsByChunk.get(chunk);
  if (cached?.metadata === metadata) return cached.details;
  const details = readInstanceDetails(metadata);
  factsByChunk.set(chunk, { metadata, details });
  return details;
}
