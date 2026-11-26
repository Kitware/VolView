declare module '@cornerstonejs/codec-openjph' {
  import type { EmbindDecoder } from '@/src/dicom/core/pixels/embindFrames';

  export type FrameInfo = {
    width: number;
    height: number;
    bitsPerSample: number;
    componentCount: number;
    isSigned: boolean;
    isUsingColorTransform: boolean;
  };

  export type HTJ2KEncoder = {
    getDecodedBuffer(frameInfo: FrameInfo): Uint8Array;
    encode(): void;
    getEncodedBuffer(): Uint8Array;
    delete(): void;
  };

  export type OpenJphModule = {
    HTJ2KDecoder: new () => EmbindDecoder;
    HTJ2KEncoder: new () => HTJ2KEncoder;
  };

  const createOpenJph: (options?: {
    locateFile?: (path: string) => string;
  }) => Promise<OpenJphModule>;
  export default createOpenJph;
}

declare module '@cornerstonejs/codec-charls/decodewasmjs' {
  import type { EmbindDecoder } from '@/src/dicom/core/pixels/embindFrames';

  const createCharLs: (options?: {
    locateFile?: (path: string) => string;
  }) => Promise<{ JpegLSDecoder: new () => EmbindDecoder }>;
  export default createCharLs;
}

declare module '@cornerstonejs/codec-openjpeg/decodewasmjs' {
  import type { EmbindDecoder } from '@/src/dicom/core/pixels/embindFrames';

  const createOpenJpeg: (options?: {
    locateFile?: (path: string) => string;
  }) => Promise<{ J2KDecoder: new () => EmbindDecoder }>;
  export default createOpenJpeg;
}
