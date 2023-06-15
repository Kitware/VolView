import type { vtkObject } from '@kitware/vtk.js/interfaces';

export * from './io';

export type ReaderType = (file: File) => vtkObject | Promise<vtkObject>;
export type FileReaderMap = Map<string, ReaderType>;

/**
 * A map of the currently registered file readers.
 *
 * Maps mime type to reader.
 */
export const FILE_READERS: FileReaderMap = new Map();
