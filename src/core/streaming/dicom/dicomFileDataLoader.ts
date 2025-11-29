import { DataLoader } from '@/src/core/streaming/types';

export class DicomFileDataLoader implements DataLoader {
  public data: Blob;

  constructor(data: Blob) {
    this.data = data;
  }

  // Data is provided, so load/stop does nothing.

  load() {}

  stop() {}
}
