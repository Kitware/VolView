const base = import.meta.env.BASE_URL ?? '';
const itkConfig = {
  pipelineWorkerUrl: `${base}/itk/pipeline.worker.js`,
  imageIOUrl: `${base}/itk/image-io`,
  meshIOUrl: `${base}/itk/mesh-io`,
  pipelinesUrl: `${base}/itk/pipelines`,
};

export default itkConfig;
