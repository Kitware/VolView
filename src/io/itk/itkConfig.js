import { join } from '@/src/utils/path';

const base = import.meta.env.BASE_URL;

const fullUrl = (relative) =>
  new URL(join(base, relative), document.location.origin).href;

const itkConfig = {
  pipelineWorkerUrl: fullUrl('/itk/pipeline.worker.js'),
  imageIOUrl: fullUrl('/itk/image-io'),
  meshIOUrl: fullUrl('/itk/mesh-io'),
  pipelinesUrl: fullUrl('/itk/pipelines'),
};

export default itkConfig;
