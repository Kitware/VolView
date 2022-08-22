import JSZip from 'jszip';
import { z } from 'zod';

export enum DataSetType {
  DICOM = 'dicom',
  IMAGE = 'image',
}

const DataSetTypeNative = z.nativeEnum(DataSetType);

const DataSet = z.object({
  id: z.string(),
  path: z.string(),
  type: DataSetTypeNative,
});
export type DataSet = z.infer<typeof DataSet>;

export const ManifestSchema = z.object({
  version: z.string(),
  dataSets: DataSet.array(),
  primarySelection: z.string().optional(),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export interface StateFile {
  zip: JSZip;
  manifest: Manifest;
}
