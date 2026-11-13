import type { DicomDataset } from '@/packages/dicom/core/metadata/dicomDataset';
import { datasetFromTags } from '@/tests/dicomDataset';

const keyOf = (tag: string) => tag.replace('|', '').toUpperCase();

function nestedDatasets(dataset: DicomDataset): DicomDataset[] {
  return dataset.elements.flatMap(({ values }) =>
    values.kind === 'sequence' ? values.items : []
  );
}

/** Change a fixture declaration wherever its functional groups supply it. */
export function setDicomTag(dataset: DicomDataset, tag: string, value: string) {
  const key = keyOf(tag);
  let found = false;
  const replace = (data: DicomDataset) => {
    data.elements = data.elements.map((element) => {
      if (element.tag !== key) return element;
      found = true;
      return datasetFromTags([[tag, value]]).elements[0];
    });
    nestedDatasets(data).forEach(replace);
  };
  replace(dataset);
  if (!found)
    dataset.elements.push(datasetFromTags([[tag, value]]).elements[0]);
}

export function removeDicomTag(dataset: DicomDataset, tag: string) {
  const key = keyOf(tag);
  dataset.elements = dataset.elements.filter((element) => element.tag !== key);
  nestedDatasets(dataset).forEach((item) => removeDicomTag(item, tag));
}

export function setDicomSequence(
  dataset: DicomDataset,
  tag: string,
  items: DicomDataset[]
) {
  const element = datasetFromTags([[tag, '']]).elements[0];
  element.vr = 'SQ';
  element.values = { kind: 'sequence', items };
  removeDicomTag(dataset, tag);
  dataset.elements.push(element);
}
