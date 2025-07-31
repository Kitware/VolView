import { DataLoader, Fetcher } from '@/src/core/streaming/types';
import { Maybe } from '@/src/types';

export class DicomDataLoader implements DataLoader {
  public data: Maybe<Blob>;
  private fetcher: Fetcher;

  constructor(fetcher: Fetcher) {
    this.fetcher = fetcher;
  }

  async load() {
    this.data = await this.fetcher.blob();
  }

  stop() {
    this.fetcher.close();
  }
}
