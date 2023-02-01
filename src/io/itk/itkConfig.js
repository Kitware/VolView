const itkConfig = {
  pipelineWorkerUrl: `${process.env.VUE_APP_PUBLIC_PATH}/itk/web-workers/min-bundles/pipeline.worker.js`,
  imageIOUrl: `${process.env.VUE_APP_PUBLIC_PATH}/itk/image-io`,
  meshIOUrl: `${process.env.VUE_APP_PUBLIC_PATH}/itk/mesh-io`,
  pipelinesUrl: `${process.env.VUE_APP_PUBLIC_PATH}/itk/pipelines`,
};

export default itkConfig;
