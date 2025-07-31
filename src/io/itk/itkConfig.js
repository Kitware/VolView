const fullUrl = (relative) => {
  // ex: /itk/image-io
  const u = new URL(document.location); // ex: http://localhost:8043/orthanc/volview/index.html
  const origin = u.origin; // ex: http://localhost:8043
  const pathParts = u.pathname.split('/'); // ex: ['', 'orthanc', 'volview', 'index.html']
  pathParts.pop(); // ex: ['', 'orthanc', 'volview']

  const url = origin + pathParts.join('/') + relative; // ex http://localhost:8043/orthanc/volview/itk/image-io
  return url;
};

const itkConfig = {
  pipelineWorkerUrl: fullUrl('/itk/itk-wasm-pipeline.min.worker.js'),
  imageIOUrl: fullUrl('/itk/image-io'),
  meshIOUrl: fullUrl('/itk/mesh-io'),
  pipelinesUrl: fullUrl('/itk/pipelines'),
};

export default itkConfig;
