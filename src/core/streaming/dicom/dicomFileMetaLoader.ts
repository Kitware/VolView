import { ReadDicomTagsFunction } from '@/src/core/streaming/dicom/dicomMetaLoader';
import { MetaLoader } from '@/src/core/streaming/types';
import { Maybe } from '@/src/types';
import { Tags } from '@/src/core/dicomTags';
import {
  encodeUltrasoundRegionMeta,
  parseUltrasoundRegionFromBlob,
} from '@/src/core/streaming/dicom/ultrasoundRegion';

export class DicomFileMetaLoader implements MetaLoader {
  public tags: Maybe<Array<[string, string]>>;
  private file: File;

  constructor(
    file: File,
    private readDicomTags: ReadDicomTagsFunction
  ) {
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

    const modality = new Map(this.tags).get(Tags.Modality)?.trim();
    if (modality === 'US') {
      const regions = await parseUltrasoundRegionFromBlob(this.file);
      if (regions) {
        this.tags.push(encodeUltrasoundRegionMeta(regions));
      }
    }
  }

  stop() {
    // do nothing
  }
}
