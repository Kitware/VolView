declare module 'dcmjs' {
  export type DicomTag = {
    toCleanString(): string;
  };

  /** `vr` and `values` are `0` for the element a read stopped at. */
  export type DicomElement = {
    tag: DicomTag;
    vr: { type: string } | 0;
    values: unknown;
    rawValues: unknown;
  };

  export type DicomReadOptions = {
    untilTag?: string;
    includeUntilTagValue?: boolean;
    forceStoreRaw?: boolean;
  };

  export type DicomStringDecoder = {
    decode(view: ArrayBufferView): string;
  };

  export type DicomReadStream = {
    offset: number;
    readonly endOffset: number;
    reset(): DicomReadStream;
    end(): boolean;
    increment(count: number): void;
    setEndian(littleEndian: boolean): void;
    readVR(): string;
    readUint16(): number;
    readUint32(): number;
    setDecoder(decoder: DicomStringDecoder): void;
    more(length: number): DicomReadStream;
    slice(start: number, end: number): ArrayBuffer;
  };

  export type DicomDataElement = {
    Value: unknown[];
  };

  const dcmjs: {
    constants: {
      encodingMapping: Record<string, string | undefined>;
    };
    data: {
      DicomMetaDictionary: {
        dictionary: Record<string, { vr: string } | undefined>;
      };
      ReadBufferStream: new (buffer: ArrayBuffer) => DicomReadStream;
      DeflatedReadBufferStream: new (
        stream: DicomReadStream
      ) => DicomReadStream;
      DicomMessage: {
        readFile(buffer: ArrayBuffer): {
          dict: Record<string, DicomDataElement | undefined>;
          write(): ArrayBuffer;
        };
        _readTag(
          stream: DicomReadStream,
          syntax: string,
          options?: DicomReadOptions
        ): DicomElement;
        _normalizeSyntax(syntax: string): string;
      };
    };
  };

  export default dcmjs;
}
