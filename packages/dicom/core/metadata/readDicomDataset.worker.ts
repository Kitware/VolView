import * as Comlink from 'comlink';
import { readDicomDataset } from './dicomDataset';

export type DicomDatasetWorker = { readDicomDataset: typeof readDicomDataset };
Comlink.expose({ readDicomDataset });
