declare module 'dcmjs' {
  export interface DicomTag {
    toCleanString(): string;
  }

  /** `vr` and `values` are `0` for the element a read stopped at. */
  export interface DicomElement {
    tag: DicomTag;
    vr: { type: string } | 0;
    values: unknown;
    rawValues: unknown;
  }

  export interface DicomReadOptions {
    untilTag?: string;
    includeUntilTagValue?: boolean;
    forceStoreRaw?: boolean;
    ignoreErrors?: boolean;
  }

  export interface DicomStringDecoder {
    decode(view: ArrayBufferView): string;
  }

  export interface DicomReadStream {
    offset: number;
    reset(): DicomReadStream;
    end(): boolean;
    increment(count: number): void;
    setEndian(littleEndian: boolean): void;
    readAsciiString(length: number): string;
    readVR(): string;
    readUint16(): number;
    readUint32(): number;
    setDecoder(decoder: DicomStringDecoder): void;
    more(length: number): DicomReadStream;
    slice(start: number, end: number): ArrayBuffer;
  }

  export interface DicomDictionaryEntry {
    tag: string;
    vr: string;
    vm: string;
    name: string;
  }

  export interface DicomDataElement {
    vr: string;
    Value: unknown[];
    _rawValue: unknown;
  }

  const dcmjs: {
    constants: {
      encodingMapping: Record<string, string | undefined>;
    };
    data: {
      DicomMetaDictionary: {
        dictionary: Record<string, DicomDictionaryEntry | undefined>;
      };
      ReadBufferStream: new (buffer: ArrayBuffer) => DicomReadStream;
      DeflatedReadBufferStream: new (
        stream: DicomReadStream
      ) => DicomReadStream;
      DicomMessage: {
        _readTag(
          stream: DicomReadStream,
          syntax: string,
          options?: DicomReadOptions
        ): DicomElement;
        _read(
          stream: DicomReadStream,
          syntax: string,
          options?: DicomReadOptions
        ): Record<string, DicomDataElement | undefined>;
        _normalizeSyntax(syntax: string): string;
      };
    };
  };

  export default dcmjs;
}
