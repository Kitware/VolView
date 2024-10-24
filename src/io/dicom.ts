import { runPipeline, TextStream, InterfaceTypes, Image } from 'itk-wasm';

import {
  readDicomTags,
  readImageDicomFileSeries,
  readOverlappingSegmentation,
  ReadOverlappingSegmentationResult,
} from '@itk-wasm/dicom';

import itkConfig from '@/src/io/itk/itkConfig';
import { getDicomSeriesWorkerPool, getWorker } from '@/src/io/itk/worker';

export interface TagSpec {
  name: string;
  tag: string;
}

export type SpatialParameters = Pick<
  Image,
  'size' | 'spacing' | 'origin' | 'direction'
>;

// volume ID => file names
export type VolumesToFileNamesMap = Record<string, string[]>;

/**
 * Filenames must be sanitized prior to being passed into itk-wasm.
 *
 * In particular, forward slashes cause FS errors in itk-wasm.
 * @param name
 * @returns
 */
function sanitizeFileName(name: string) {
  return name.replace(/\//g, '_');
}

/**
 * Returns a new File instance with a sanitized name.
 * @param file
 */
function sanitizeFile(file: File) {
  return new File([file], sanitizeFileName(file.name));
}

async function runTask(
  module: string,
  args: any[],
  inputs: any[],
  outputs: any[]
) {
  return runPipeline(module, args, outputs, inputs, {
    webWorker: getWorker(),
    pipelineBaseUrl: itkConfig.pipelinesUrl,
    pipelineWorkerUrl: itkConfig.pipelineWorkerUrl,
  });
}

/**
 * Split and sort DICOM files
 * @async
 * @returns volumeID => file names mapping
 */
export async function splitAndSort<T>(
  instances: T[],
  mapToBlob: (inst: T, index: number) => Blob
) {
  const inputs = await Promise.all(
    instances.map(async (instance, index) => {
      const blob = mapToBlob(instance, index);
      const buffer = await blob.arrayBuffer();
      return {
        type: InterfaceTypes.BinaryFile,
        data: {
          path: index.toString(), // make each file name unique
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

  const result = await runTask('dicom', args, inputs, outputs);

  // File names are indexes into input files array
  const volumeToFileIndexes = JSON.parse(
    (result.outputs[0].data as TextStream).data
  ) as VolumesToFileNamesMap;

  const volumeToInstances = Object.fromEntries(
    Object.entries(volumeToFileIndexes).map(([volumeKey, fileIndexes]) => [
      volumeKey,
      // file indexes to Files
      fileIndexes.map((fileIndex) => instances[parseInt(fileIndex, 10)]),
    ])
  );

  return volumeToInstances;
}

/**
 * Reads a list of tags out from a given file.
 *
 * @param {File} file
 * @param {[]Tag} tags
 */
export async function readTags<T extends TagSpec[]>(
  file: File,
  tags: T
): Promise<Record<T[number]['name'], string>> {
  const tagsArgs = { tagsToRead: { tags: tags.map(({ tag }) => tag) } };

  const result = await readDicomTags(sanitizeFile(file), {
    ...tagsArgs,
    webWorker: getWorker(),
  });
  const tagValues = new Map(result.tags);

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
export async function readVolumeSlice(
  file: File,
  asThumbnail: boolean = false
) {
  const buffer = await file.arrayBuffer();

  const inputs = [
    {
      type: InterfaceTypes.BinaryFile,
      data: {
        path: sanitizeFileName(file.name),
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
    sanitizeFileName(file.name),
    '--memory-io',
    '0',
  ];

  const outputs = [{ type: InterfaceTypes.Image }];

  const result = await runTask('dicom', args, inputs, outputs);

  return result.outputs[0].data as Image;
}

type Segment = {
  SegmentLabel: string;
  labelID: number;
  recommendedDisplayRGBValue: [number, number, number];
};

type ReadOverlappingSegmentationMeta = {
  segmentAttributes: Segment[][];
};

type ReadOverlappingSegmentationResultWithRealMeta =
  ReadOverlappingSegmentationResult & {
    metaInfo: ReadOverlappingSegmentationMeta;
  };

export async function buildSegmentGroups(file: File) {
  const inputImage = sanitizeFile(file);
  const result = (await readOverlappingSegmentation(inputImage, {
    webWorker: getWorker(),
    mergeSegments: true,
  })) as ReadOverlappingSegmentationResultWithRealMeta;
  return {
    ...result,
    outputImage: result.segImage,
  };
}

/**
 * Builds a volume for a set of files.
 * @async
 * @param {File[]} seriesFiles the set of files to build volume from
 * @returns ItkImage
 */
export async function buildImage(seriesFiles: File[]) {
  const inputImages = seriesFiles.map((file) => sanitizeFile(file));
  const result = await readImageDicomFileSeries({
    webWorkerPool: getDicomSeriesWorkerPool(),
    inputImages,
    singleSortedSeries: false,
  });
  return result;
}
