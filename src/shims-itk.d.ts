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

declare module 'itk/ImageType' {
  export interface ImageType {
    dimension: number;
    componentType: string;
    pixelType: string;
    components: number;
  }

  export default ImageType;
}

declare module 'itk/Image' {
  import ImageType from 'itk/ImageType';
  type TypedArray =
    | Uint8Array
    | Uint8ClampedArray
    | Int8Array
    | Uint16Array
    | Int16Array
    | Uint32Array
    | Int32Array
    | Float32Array
    | Float64Array;

  export interface Image {
    imageType: ImageType;
    origin: number[];
    spacing: number[];
    direction: number[];
    size: number[];
    data: TypedArray | null;
  }

  export default Image;
}
