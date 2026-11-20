import type { vtkObject } from '@kitware/vtk.js/interfaces';

export * from './io';

export type ReaderResult = {
  dataObject: vtkObject;
  // File-format header fields (e.g. NRRD key/value pairs) that don't survive
  // conversion to vtk data structures. Consumers that know a convention parse
  // them (see parseSegNrrdMetadata).
  headerMetadata?: Map<string, string>;
};
export type ReaderType = (file: File) => ReaderResult | Promise<ReaderResult>;
export type FileReaderMap = Map<string, ReaderType>;

/**
 * A map of the currently registered file readers.
 *
 * Maps mime type to reader.
 */
export const FILE_READERS: FileReaderMap = new Map();
