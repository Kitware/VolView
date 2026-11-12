const HOUNSFIELD_UNITS = ['HU', 'HOUNSFIELD UNIT', 'HOUNSFIELD UNITS'];

const firstField = (fields: Map<string, string>, keys: string[]) =>
  keys.map((key) => fields.get(key)).find(Boolean);

export function getDeclaredModality(
  dicomModality: string | undefined,
  headerMetadata: Iterable<readonly [string, string]> = []
) {
  const fields = new Map(
    Array.from(headerMetadata, ([key, value]) => [
      key.trim().toLowerCase(),
      value.trim().toUpperCase(),
    ])
  );
  const modality =
    dicomModality?.trim().toUpperCase() ||
    firstField(fields, ['0008|0060', 'modality']);
  // MetaImage headers spell modalities as MET_MOD_CT, MET_MOD_MR, ...
  if (modality) return modality.replace(/^MET_MOD_/, '');

  // Only scalar units identify CT; spatial units and value ranges do not.
  const units = firstField(fields, [
    '0028|1054',
    'rescaletype',
    'intensityunits',
  ]);
  return units && HOUNSFIELD_UNITS.includes(units) ? 'CT' : '';
}
