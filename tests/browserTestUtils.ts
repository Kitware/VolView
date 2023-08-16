export function makeEmptyFile(name: string) {
  return new File([], name);
}

export function makeDicomFile(name: string) {
  const buffer = new Uint8Array(132);
  buffer[128] = 'D'.charCodeAt(0);
  buffer[129] = 'I'.charCodeAt(0);
  buffer[130] = 'C'.charCodeAt(0);
  buffer[131] = 'M'.charCodeAt(0);
  return new File([buffer.buffer], name);
}
