declare module '@cornerstonejs/codec-openjph' {
  export type FrameInfo = {
    width: number;
    height: number;
    bitsPerSample: number;
    componentCount: number;
    isSigned: boolean;
    isUsingColorTransform: boolean;
  };

  /** An Embind object: it lives on the WASM heap until `delete`. */
  export type HTJ2KDecoder = {
    getEncodedBuffer(length: number): Uint8Array;
    decode(): void;
    getFrameInfo(): FrameInfo;
    /** A view of the WASM heap, valid until the next call. */
    getDecodedBuffer(): Uint8Array;
    delete(): void;
  };

  export type HTJ2KEncoder = {
    getDecodedBuffer(frameInfo: FrameInfo): Uint8Array;
    encode(): void;
    getEncodedBuffer(): Uint8Array;
    delete(): void;
  };

  export type OpenJphModule = {
    HTJ2KDecoder: new () => HTJ2KDecoder;
    HTJ2KEncoder: new () => HTJ2KEncoder;
  };

  const createOpenJph: (options?: {
    locateFile?: (path: string) => string;
  }) => Promise<OpenJphModule>;
  export default createOpenJph;
}
