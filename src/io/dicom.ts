import {
  runPipeline,
  TextStream,
  InterfaceTypes,
  readDICOMTags,
  readImageDICOMFileSeries,
  Image,
} from 'itk-wasm';

export interface TagSpec {
  name: string;
  tag: string;
}

// volume ID => file names
export type VolumesToFilesMap = Record<string, string[]>;

export type SeriesPipeline = {
  kind: 'series';
  files: File[];
};

export type PtCtPipeline = {
  kind: 'pt-ct';
  ctFiles: File[];
  ptFiles: File[];
};

export type Pipeline = SeriesPipeline | PtCtPipeline;

export class DICOMIO {
  private webWorker: any;
  private initializeCheck: Promise<void> | null;

  constructor() {
    this.webWorker = null;
    this.initializeCheck = null;
  }

  private async runTask(
    module: string,
    args: any[],
    inputs: any[],
    outputs: any[]
  ) {
    return runPipeline(this.webWorker, module, args, outputs, inputs);
  }

  /**
   * Helper that initializes the webworker.
   *
   * @async
   * @throws Error initialization failed
   */
  private async initialize() {
    if (!this.initializeCheck) {
      this.initializeCheck = new Promise<void>((resolve, reject) => {
        this.runTask('dicom', [], [], [])
          .then((result) => {
            if (result.webWorker) {
              this.webWorker = result.webWorker;
            } else {
              reject(new Error('Could not initialize webworker'));
            }
          })
          .then(async () => {
            // preload read-dicom-tags pipeline
            try {
              await readDICOMTags(this.webWorker, new File([], ''), null);
            } catch {
              // ignore
            }
            resolve();
          })
          .catch(reject);
      });
    }

    return this.initializeCheck;
  }

  /**
   * Categorize files
   * @async
   * @param {File[]} files
   * @returns volumeID => file names mapping
   */
  async categorizeFiles(files: File[]): Promise<VolumesToFilesMap> {
    await this.initialize();

    const inputs = await Promise.all(
      files.map(async (file) => {
        const buffer = await file.arrayBuffer();
        return {
          type: InterfaceTypes.BinaryFile,
          data: {
            path: file.name,
            data: new Uint8Array(buffer),
          },
        };
      })
    );

    const args = [
      '--action',
      'categorize',
      '--memory-io',
      '0',
      '--files',
      ...inputs.map((fd) => fd.data.path),
    ];

    const outputs = [{ type: InterfaceTypes.TextStream }];

    const result = await this.runTask('dicom', args, inputs, outputs);

    return JSON.parse((result.outputs[0].data as TextStream).data);
  }

  /**
   * Reads a list of tags out from a given file.
   *
   * @param {File} file
   * @param {[]Tag} tags
   */
  async readTags<T extends TagSpec[]>(
    file: File,
    tags: T
  ): Promise<Record<T[number]['name'], string>> {
    const tagsArgs = tags.map((t) => t.tag);

    const result = await readDICOMTags(this.webWorker, file, tagsArgs);
    const tagValues = result.tags;

    return tags.reduce((info, t) => {
      const { tag, name } = t;
      if (tagValues.has(tag)) {
        return { ...info, [name]: tagValues.get(tag) };
      }
      return info;
    }, {} as Record<T[number]['name'], string>);
  }

  /**
   * Retrieves a slice of a volume.
   * @async
   * @param {File} file containing the slice
   * @param {Boolean} asThumbnail cast image to unsigned char. Defaults to false.
   * @returns ItkImage
   */
  async getVolumeSlice(file: File, asThumbnail: boolean = false) {
    await this.initialize();

    const buffer = await file.arrayBuffer();

    const inputs = [
      {
        type: InterfaceTypes.BinaryFile,
        data: {
          path: file.name,
          data: new Uint8Array(buffer),
        },
      },
    ];

    const args = [
      '--action',
      'getSliceImage',
      '--thumbnail',
      asThumbnail.toString(),
      '--file',
      file.name,
      '--memory-io',
      '0',
    ];

    const outputs = [{ type: InterfaceTypes.Image }];

    const result = await this.runTask('dicom', args, inputs, outputs);

    return result.outputs[0].data as Image;
  }

  async resample(fixed: Image, moving: Image) {
    await this.initialize();

    const { size, spacing, origin, direction } = fixed;
    const args = [
      '--action',
      'resample',
      '0', // space for input image

      '--size',
      size.join(','),
      '--spacing',
      spacing.join(','),
      '--origin',
      origin.join(','),
      '--direction',
      direction.join(','),

      '--memory-io',
      '0',
    ];

    const inputs = [{ type: InterfaceTypes.Image, data: moving }];
    const outputs = [{ type: InterfaceTypes.Image }];

    const result = await this.runTask('dicom', args, inputs, outputs);
    const image = result.outputs[0].data as Image;
    return image;
  }

  async fuse(fixedFiles: File[], movingFiles: File[]) {
    await this.initialize();

    const { image: fixed } = await readImageDICOMFileSeries(fixedFiles);
    const { image: moving } = await readImageDICOMFileSeries(movingFiles);
    const movingInFixedSpace = await this.resample(fixed, moving);

    return [fixed, movingInFixedSpace];
  }

  /**
   * Builds a volume per a pipeline.
   * @async
   * @param {Pipeline} pipeline structure to build volumes from
   * @returns ItkImage[]
   */
  async buildVolume(pipeline: Pipeline) {
    await this.initialize();

    if (pipeline.kind === 'series')
      return [(await readImageDICOMFileSeries(pipeline.files)).image];

    if (pipeline.kind === 'pt-ct')
      return this.fuse(pipeline.ctFiles, pipeline.ptFiles);

    const exhaustiveCheck: never = pipeline;
    return exhaustiveCheck;
  }
}
