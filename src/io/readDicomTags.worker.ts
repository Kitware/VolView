import * as Comlink from 'comlink';
import { readDicomTags } from '@/src/io/readDicomTags';

export interface ReadDicomTagsWorker {
  readDicomTags: typeof readDicomTags;
}

Comlink.expose({ readDicomTags });
