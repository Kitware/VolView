import type { DicomDataset } from '../metadata/dicomDataset';
import { readInstanceDetails } from './instanceFacts';

// Parsed datasets are immutable, so derived facts live as long as the dataset.
const detailsByDataset = new WeakMap<
  DicomDataset,
  ReturnType<typeof readInstanceDetails>
>();

export function readDatasetDetails(dataset: DicomDataset) {
  const cached = detailsByDataset.get(dataset);
  if (cached) return cached;
  const details = readInstanceDetails(dataset);
  detailsByDataset.set(dataset, details);
  return details;
}
