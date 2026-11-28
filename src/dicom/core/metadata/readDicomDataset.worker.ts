import * as Comlink from 'comlink';
import { readPublicDataset } from './dicomDataset';

export type DicomDatasetWorker = {
  readPublicDataset: typeof readPublicDataset;
};
Comlink.expose({ readPublicDataset });
