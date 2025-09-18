const fullUrl = (relative) => {
  // In development, use the dev server port directly
  if (import.meta.env.DEV) {
    return `http://localhost:5173${relative}`;
  }

  // Production: use document location
  const u = new URL(document.location);
  const origin = u.origin;
  const pathParts = u.pathname.split('/');
  pathParts.pop();

  const url = origin + pathParts.join('/') + relative;
  return url;
};

const itkConfig = {
  pipelineWorkerUrl: fullUrl('/itk/itk-wasm-pipeline.min.worker.js'),
  imageIOUrl: fullUrl('/itk/image-io'),
  meshIOUrl: fullUrl('/itk/mesh-io'),
  pipelinesUrl: fullUrl('/itk/pipelines'),
};

export default itkConfig;
