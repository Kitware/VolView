import {
  runPipeline,
  InterfaceTypes,
  imageSharedBufferOrCopy,
  WorkerPool,
  stackImages,
} from 'itk-wasm';

import itkConfig from '@/src/io/itk/itkConfig';

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

    return [pipeline, taskArgs, outputs, inputs, {
      pipelineBaseUrl: itkConfig.pipelinesUrl,
      pipelineWorkerUrl: itkConfig.pipelineWorkerUrl,
    }];


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
