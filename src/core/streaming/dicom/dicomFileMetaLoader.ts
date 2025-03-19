import { ReadDicomTagsFunction } from '@/src/core/streaming/dicom/dicomMetaLoader';
import { MetaLoader } from '@/src/core/streaming/types';
import { Maybe } from '@/src/types';

export class DicomFileMetaLoader implements MetaLoader {
  public tags: Maybe<Array<[string, string]>>;
  private file: File;

  constructor(file: File, private readDicomTags: ReadDicomTagsFunction) {
    this.file = file;
  }

  get meta() {
    return this.tags;
  }

  get metaBlob() {
    return this.file;
  }

  async load() {
    if (this.tags) return;
    this.tags = await this.readDicomTags(this.file);
  }

  // eslint-disable-next-line class-methods-use-this
  stop() {
    // do nothing
  }
}
