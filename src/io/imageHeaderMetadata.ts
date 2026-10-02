// Loader provenance is separate from file-format metadata. VTK spacing alone
// cannot distinguish declared physical sampling from a reader's fallback.
export const CALIBRATED_SPACING_AXES = 'volview:calibrated-spacing-axes';

type ImageHeader = {
  spacing: number[];
  metadata?: Map<string, unknown>;
};

const positive = (value: number) => Number.isFinite(value) && value > 0;
const millimeters = (unit: string) =>
  ['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres'].includes(
    unit.toLowerCase()
  );

function nrrdDirectionCalibration(directions: string, units: string[]) {
  const vectors = directions.match(/\([^)]*\)|none/gi) ?? [];
  return vectors.map((vector) => {
    const components = vector.slice(1, -1).split(',').map(Number);
    return (
      components.length === 3 &&
      components.every(Number.isFinite) &&
      components.some((value) => value !== 0) &&
      components.every(
        (value, axis) => value === 0 || millimeters(units[axis] ?? '')
      )
    );
  });
}

async function nrrdCalibration(file: File) {
  // Headers exceeding this limit remain renderable, without claiming physical
  // calibration. Do not decode voxel data merely to inspect header fields.
  const prefix = await file.slice(0, 65536).text();
  const end = prefix.search(/\r?\n\r?\n/);
  if (!/^NRRD000\d\r?\n/.test(prefix) || end < 0) return [];
  const fields = new Map(
    prefix
      .slice(0, end)
      .split(/\r?\n/)
      .flatMap((line): Array<[string, string]> => {
        const match = /^([^#:=]+):(?![=])\s*(.*)$/.exec(line);
        return match ? [[match[1].trim().toLowerCase(), match[2]]] : [];
      })
  );
  const units = Array.from(
    (fields.get('space units') ?? '').matchAll(/"([^"\\]*)"/g),
    (match) => match[1]
  );
  const directions = fields.get('space directions');
  if (directions) return nrrdDirectionCalibration(directions, units);
  return (fields.get('spacings') ?? '')
    .trim()
    .split(/\s+/)
    .map(
      (spacing, axis) =>
        positive(Number(spacing)) && millimeters(units[axis] ?? '')
    );
}

async function niftiHeader(file: File) {
  const prefix = new Uint8Array(await file.slice(0, 544).arrayBuffer());
  if (prefix[0] !== 0x1f || prefix[1] !== 0x8b) return prefix;
  if (typeof DecompressionStream === 'undefined') return new Uint8Array();
  const reader = file
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
    .getReader();
  const header = new Uint8Array(544);
  let length = 0;
  try {
    while (length < header.length) {
      const { done, value } = await reader.read();
      if (done) break;
      const count = Math.min(value.length, header.length - length);
      header.set(value.subarray(0, count), length);
      length += count;
    }
  } finally {
    await reader.cancel();
  }
  return header.subarray(0, length);
}

async function niftiCalibration(file: File) {
  const bytes = await niftiHeader(file);
  if (bytes.length < 348) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const littleEndian = [348, 540].includes(view.getInt32(0, true));
  const size = view.getInt32(0, littleEndian);
  if (![348, 540].includes(size) || bytes.length < size) return [];
  const version2 = size === 540;
  const offset = version2 ? 4 : 344;
  const magic = new TextDecoder().decode(bytes.subarray(offset, offset + 4));
  const version = version2 ? 2 : 1;
  if (![`n+${version}\0`, `ni${version}\0`].includes(magic)) return [];
  // ITK normalizes known NIfTI spatial units into millimeters, but also
  // repairs invalid pixdim values. Read declaration bytes before those repairs.
  const units = version2
    ? view.getInt32(500, littleEndian)
    : view.getUint8(123);
  const physical = [1, 2, 3].includes(units & 7);
  return [1, 2, 3].map((axis) => {
    const spacing = version2
      ? view.getFloat64(104 + axis * 8, littleEndian)
      : view.getFloat32(76 + axis * 4, littleEndian);
    return physical && positive(spacing);
  });
}

async function declaredCalibration(file: File, metadata: Map<string, string>) {
  try {
    return metadata.get('ITK_InputFilterName') === 'NrrdImageIO'
      ? await nrrdCalibration(file)
      : await niftiCalibration(file);
  } catch {
    // Optional calibration evidence must not prevent an otherwise valid image
    // from loading when its header cannot be inspected.
    return [];
  }
}
/** Keep format metadata and pre-repair calibration evidence through ITK→VTK. */
export async function imageHeaderMetadata(file: File, image: ImageHeader) {
  const metadata = new Map<string, string>();
  image.metadata?.forEach((value, key) => {
    metadata.set(key, typeof value === 'string' ? value : String(value));
  });
  const declared = await declaredCalibration(file, metadata);
  const axes = [0, 1, 2].map(
    (axis) => declared[axis] === true && positive(image.spacing[axis])
  );
  metadata.set(CALIBRATED_SPACING_AXES, axes.map(Number).join(','));
  return metadata;
}
