import { ChunkImage } from '@/src/core/streaming/chunkImage';
import { defineStore } from 'pinia';
import { reactive } from 'vue';

const useChunkStore = defineStore('chunks', () => {
  const chunkImageById = reactive<Record<string, ChunkImage>>({});

  return {
    chunkImageById,
  };
});

export default useChunkStore;
