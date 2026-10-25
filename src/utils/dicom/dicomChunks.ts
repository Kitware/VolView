import { Chunk } from '@/src/core/streaming/chunk';

/**
 * Value of one tag, keyed 'gggg|eeee'.
 *
 * Chunk metadata is the whole file header, so this scans rather than
 * materializing a Map: per-chunk paths read a handful of tags and a Map per
 * chunk would retain a second copy of every header for the session.
 */
export function getChunkTag(chunk: Chunk, tag: string) {
  return chunk.metadata?.find(([key]) => key === tag)?.[1];
}

/** Chunk metadata as a Map. For reading many tags off a single chunk. */
export const getChunkMetadata = (chunk: Chunk) => new Map(chunk.metadata ?? []);
