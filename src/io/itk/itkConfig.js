const base = process.env.VUE_APP_PUBLIC_PATH ?? '';
const itkConfig = {
  pipelineWorkerUrl: `${base}/itk/web-workers/min-bundles/pipeline.worker.js`,
  imageIOUrl: `${base}/itk/image-io`,
  meshIOUrl: `${base}/itk/mesh-io`,
  pipelinesUrl: `${base}/itk/pipelines`,
};

export default itkConfig;
