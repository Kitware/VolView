declare module 'itk/IOTypes' {
  const IOTypes = {
    Text: 'Text',
    Binary: 'Binary',
    Image: 'Image',
    Mesh: 'Mesh',
    vtkPolyData: 'vtkPolyData',
  } as const;

  export default IOTypes;
}

declare module 'itk/runPipelineBrowser' {
  async function runPipelineBrowser(
    webWorker: Worker | null | boolean,
    pipelinePath: string | URL,
    args: string[],
    outputs: PipelineOutput[] | null,
    inputs: PipelineInput[] | null
  ): Promise<any>;

  export = runPipelineBrowser;
}

declare module 'itk/extensionToImageIO' {
  export default {} as Map<string, string>;
}

declare module 'itk/readImageArrayBuffer' {
  export default () => any;
}
