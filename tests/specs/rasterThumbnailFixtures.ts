import * as zlib from 'zlib';

const SIZE = 128;
const RGB_JPEG_BASE64 =
  '/9j//gARTGF2YzU4LjEzNC4xMDAA/9sAQwAIBAQEBAQFBQUFBQUGBgYGBgYGBgYGBgYGBwcHCAgIBwcHBgYHBwgICAgJCQkICAgICQkKCgoMDAsLDg4OEREU/8QAUQABAQEAAAAAAAAAAAAAAAAAAAUGAQEAAwEBAAAAAAAAAAAAAAAABggEBQcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCACAAIADARIAAhIAAxIA/9oADAMBAAIRAxEAPwDJDIJAAAAAAAAAAAAAAAKYyiCAAAAAAAAAAAAAACYNQnYAAAAAAAAAAAAAApjKIIAAAAAAAAAAAAAAJg1CdgAAAAAAAAAAAAACmMoggAAAAAAAAAAAAAAmDUJ2AAAAAAAAAAAAAAKYyiCAAAAAAAAAAAAAACYNQ9oAAAAAAAAAAAAAAGvHFFbAAAAAAAAAAAAAABkB2hZMAAAAAAAAAAAAAAa8cUVsAAAAAAAAAAAAAAGQHaFkwAAAAAAAAAAAAABrxxRWwAAAAAAAAAAAAAAZAdoWTAAAAAAAAAAAAAAGvHFFbAAAAAAAAAAAAAAB/9k=';

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer) {
  const payload = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(payload));
  return Buffer.concat([length, payload, checksum]);
}

function createPng(
  channels: 1 | 3 | 4,
  pixel: (x: number, y: number) => number[]
) {
  const rowLength = 1 + SIZE * channels;
  const pixels = Buffer.alloc(rowLength * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      pixels.set(pixel(x, y), y * rowLength + 1 + x * channels);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8;
  const colorTypes = { 1: 0, 3: 2, 4: 6 } as const;
  header[9] = colorTypes[channels];
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const rgbColors = (x: number, y: number) => {
  if (x < SIZE / 2 && y < SIZE / 2) return [128, 64, 64];
  if (x >= SIZE / 2 && y < SIZE / 2) return [64, 128, 64];
  if (x < SIZE / 2) return [192, 32, 64];
  return [32, 192, 64];
};

const colorsWithAlpha = (x: number, y: number) => {
  if (x < SIZE / 2 && y < SIZE / 2) return [255, 0, 0, 255];
  if (x >= SIZE / 2 && y < SIZE / 2) return [0, 255, 0, 128];
  if (x < SIZE / 2) return [0, 0, 255, 0];
  return [255, 255, 0, 255];
};

export function createRasterFixture(name: string) {
  if (name === 'rgb-thumbnail.png') return createPng(3, rgbColors);
  if (name === 'rgba-thumbnail.png') return createPng(4, colorsWithAlpha);
  if (name === 'gray-thumbnail.png')
    return createPng(1, (x) => [Math.floor((x * 255) / (SIZE - 1))]);
  if (name === 'rgb-thumbnail.jpg')
    return Buffer.from(RGB_JPEG_BASE64, 'base64');
  throw new Error(`Unknown raster fixture: ${name}`);
}
