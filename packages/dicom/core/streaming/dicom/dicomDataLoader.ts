import { DataLoader, Fetcher } from '../types';
import { Maybe } from '../../utils';

export class DicomDataLoader implements DataLoader {
  public data: Maybe<Blob>;
  private fetcher: Fetcher | null;
  private generation = 0;

  constructor(fetcher: Fetcher) {
    this.fetcher = fetcher;
  }

  async load() {
    const generation = this.generation;
    if (!this.fetcher)
      throw new DOMException('DICOM data loader disposed', 'AbortError');
    const data = await this.fetcher.blob();
    if (generation !== this.generation)
      throw new DOMException('DICOM read cancelled', 'AbortError');
    this.data = data;
  }

  dispose() {
    this.stop();
    this.data = undefined;
    this.fetcher = null;
  }

  stop() {
    this.generation += 1;
    this.fetcher?.close();
  }
}
