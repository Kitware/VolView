const ITEM = 0xe000;
const SEQUENCE_DELIMITER = 0xe0dd;
const ITEM_GROUP = 0xfffe;
const ITEM_HEAD_LENGTH = 8;
const UNDEFINED_LENGTH = 0xffffffff;

type Fragment = Readonly<{
  /** Offset of the item tag from the first fragment item, as offset tables count. */
  offset: number;
  bytes: Uint8Array;
}>;

const malformed = (detail: string) =>
  new Error(`Malformed encapsulated Pixel Data: ${detail}`);

/** The items of an encapsulated Pixel Data value, up to its delimiter or the end. */
function readItems(value: Uint8Array) {
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  const items: Array<{ position: number; bytes: Uint8Array }> = [];
  let position = 0;
  while (position < value.length) {
    if (position + ITEM_HEAD_LENGTH > value.length)
      throw malformed(`an item head at byte ${position} is cut short`);
    const group = view.getUint16(position, true);
    const element = view.getUint16(position + 2, true);
    const length = view.getUint32(position + 4, true);
    if (group === ITEM_GROUP && element === SEQUENCE_DELIMITER) return items;
    if (group !== ITEM_GROUP || element !== ITEM)
      throw malformed(
        `expected an item at byte ${position}, found tag (${group.toString(16)},${element.toString(16)})`
      );
    if (length === UNDEFINED_LENGTH)
      throw malformed(`the item at byte ${position} has an undefined length`);
    const start = position + ITEM_HEAD_LENGTH;
    if (start + length > value.length)
      throw malformed(
        `the item at byte ${position} needs ${length} bytes; ${value.length - start} remain`
      );
    items.push({ position, bytes: value.subarray(start, start + length) });
    position = start + length;
  }
  // A value that ends exactly after its last item is read as if delimited.
  return items;
}

function readOffsetTable(table: Uint8Array) {
  if (table.length % 4 !== 0)
    throw malformed(`the Basic Offset Table holds ${table.length} bytes`);
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  return Array.from({ length: table.length / 4 }, (_, index) =>
    view.getUint32(index * 4, true)
  );
}

const joinFragments = (fragments: readonly Fragment[]) => {
  if (fragments.length === 1) return fragments[0].bytes;
  const out = new Uint8Array(
    fragments.reduce((total, { bytes }) => total + bytes.length, 0)
  );
  fragments.reduce((offset, { bytes }) => {
    out.set(bytes, offset);
    return offset + bytes.length;
  }, 0);
  return out;
};

function framesFromOffsets(fragments: readonly Fragment[], offsets: number[]) {
  const starts = offsets.map((offset, frame) => {
    const index = fragments.findIndex((fragment) => fragment.offset === offset);
    if (index < 0)
      throw malformed(
        `Basic Offset Table entry ${frame} (${offset}) starts no fragment`
      );
    return index;
  });
  if (starts[0] !== 0)
    throw malformed(
      `Basic Offset Table entry 0 (${offsets[0]}) skips the first fragment`
    );
  return starts.map((start, frame) => {
    const end =
      frame + 1 < starts.length ? starts[frame + 1] : fragments.length;
    if (end <= start)
      throw malformed(
        `Basic Offset Table entry ${frame + 1} does not increase`
      );
    return fragments.slice(start, end);
  });
}

const endsWithEoi = (bytes: Uint8Array) =>
  bytes.length >= 2 &&
  bytes[bytes.length - 2] === 0xff &&
  bytes[bytes.length - 1] === 0xd9;

// One zero pad byte may follow the marker, since items have even length.
const endsJpegImage = ({ bytes }: Fragment) =>
  endsWithEoi(bytes) ||
  (bytes[bytes.length - 1] === 0 && endsWithEoi(bytes.subarray(0, -1)));

const framesAtJpegEnds = (fragments: readonly Fragment[]) =>
  fragments.reduce<Fragment[][]>((grouped, fragment, index) => {
    if (index === 0 || endsJpegImage(fragments[index - 1]))
      grouped.push([fragment]);
    else grouped[grouped.length - 1].push(fragment);
    return grouped;
  }, []);

/**
 * Cuts an encapsulated Pixel Data value (the bytes after its element head)
 * into `frameCount` frames. The first item is the Basic Offset Table; its
 * offsets decide when it has one per frame. Otherwise one fragment per frame
 * when the counts match. Otherwise a frame ends at each fragment ending in a
 * JPEG End Of Image marker, so that last rule holds only for JPEG codecs.
 * A frame of one fragment is a view into `value`; a frame of several is a copy.
 */
export function splitEncapsulatedFrames(value: Uint8Array, frameCount: number) {
  const items = readItems(value);
  if (items.length === 0) throw malformed('no Basic Offset Table item');
  const [table, ...rest] = items;
  const base = rest[0]?.position ?? 0;
  const fragments = rest.map(({ position, bytes }) => ({
    offset: position - base,
    bytes,
  }));
  if (fragments.length === 0) throw malformed('no fragments');
  const offsets = readOffsetTable(table.bytes);
  const frames =
    offsets.length === frameCount
      ? framesFromOffsets(fragments, offsets)
      : fragments.length === frameCount
        ? fragments.map((fragment) => [fragment])
        : framesAtJpegEnds(fragments);
  if (frames.length !== frameCount)
    throw malformed(
      `found ${frames.length} frames in ${fragments.length} fragments; the header declares ${frameCount}`
    );
  return frames.map(joinFragments);
}
