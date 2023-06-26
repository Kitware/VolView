import {
  runPipeline,
  InterfaceTypes,
  imageSharedBufferOrCopy,
  WorkerPool,
  stackImages,
} from 'itk-wasm';
import { join } from '@/src/utils/path';

export async function runWasm(
  pipeline,
  args,
  images,
  outputs = [{ type: InterfaceTypes.Image }]
) {
  const numberOfWorkers = navigator.hardwareConcurrency
    ? navigator.hardwareConcurrency
    : 6;

  const aImage = images[0];
  const splits = Math.min(
    parseInt(numberOfWorkers / 2, 10),
    Math.max(aImage.size[aImage.size.length - 1], 1),
    4 // avoid out of memory errors with larger images
  );

  const splitsArg = splits.toString();
  const tasks = [...Array(splits).keys()].map((split) => {
    const taskArgs = [
      ...[...Array(images.length).keys()].map((num) => num.toString()),
      '0', // input image space
      ...args,
      '--max-total-splits',
      splitsArg,
      '--split',
      split.toString(),
      '--number-of-splits',
      splitsArg,
      '--memory-io',
    ];

    const inputs = images.map((image) => ({
      type: InterfaceTypes.Image,
      data: imageSharedBufferOrCopy(image),
    }));

    return [pipeline, taskArgs, outputs, inputs, join(import.meta.env.BASE_URL, '/itk/pipelines'),
      join(import.meta.env.BASE_URL, '/itk/pipeline.worker.js')];
  });

  const workerPool = new WorkerPool(numberOfWorkers, runPipeline);
  const results = await workerPool.runTasks(tasks).promise;
  workerPool.terminateWorkers();
  const validResults = results.filter((r) => r.returnValue === 0);
  const imageSplits = validResults.map(
    ({ outputs: pipelineOutput }) => pipelineOutput[0].data
  );

  return stackImages(imageSplits);
}
