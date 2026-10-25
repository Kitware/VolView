import { encodingLabel, toBytes } from '@/src/io/dcmjsParser';

const ESCAPE_BYTE = 0x1b;

export const VALUE_DELIMITER = '\\';

/** Bytes a conforming writer resets the repertoire before. */
const DELIMITER_BYTES = new Set([0x0a, 0x0c, 0x0d, 0x3d, 0x5c, 0x5e]);

/**
 * The VRs a Specific Character Set applies to, from PS3.5 6.1.2 and PS3.3
 * C.12.1.1.2. Every other string VR, DS and IS included, stays in the default
 * repertoire, so no charset transform can reach a numeric value.
 */
export const CHARSET_VRS = new Set(['SH', 'LO', 'ST', 'PN', 'LT', 'UC', 'UT']);

/** Bytes of a VR the Specific Character Set does not reach are code points. */
export const defaultRepertoire = (raw: string) => raw;

/** A repertoire in force over one run of bytes. */
type Repertoire = {
  decode: (bytes: Uint8Array) => string;
  multibyte: boolean;
};

const tryDecode = (decoder: TextDecoder, bytes: Uint8Array) => {
  try {
    return decoder.decode(bytes);
  } catch {
    return undefined;
  }
};

const highHalf = (bytes: Uint8Array) => bytes.map((byte) => byte | 0x80);

/** JIS X 0212 rides EUC-JP's third plane, one 0x8f before each high half pair. */
const jisX0212Bytes = (bytes: Uint8Array) =>
  Uint8Array.from(
    Array.from({ length: Math.floor(bytes.length / 2) }, (_, pair) => [
      0x8f,
      bytes[pair * 2] | 0x80,
      bytes[pair * 2 + 1] | 0x80,
    ]).flat()
  );

const repertoire = (
  label: string,
  {
    multibyte = false,
    mapBytes = (bytes: Uint8Array) => bytes,
  }: { multibyte?: boolean; mapBytes?: (bytes: Uint8Array) => Uint8Array } = {}
): Repertoire => {
  const decoder = new TextDecoder(label);
  return { decode: (bytes) => decoder.decode(mapBytes(bytes)), multibyte };
};

/** Final byte of an `ESC -` designation to the decoder for its high half. */
const G1_LABELS: Record<string, string> = {
  A: 'latin1',
  B: 'iso-8859-2',
  C: 'iso-8859-3',
  D: 'iso-8859-4',
  F: 'iso-ir-126',
  G: 'iso-ir-127',
  H: 'iso-ir-138',
  L: 'iso-ir-144',
  M: 'iso-ir-148',
  T: 'tis-620',
};

/**
 * The ISO 2022 designations DICOM allows, keyed by the bytes following the
 * escape. `ESC ( B` and `ESC ( J` return to the default repertoire, so they are
 * added per file where that default is known.
 */
const DESIGNATIONS: Record<string, Repertoire> = {
  '(I': repertoire('shift-jis', { mapBytes: highHalf }),
  ')I': repertoire('shift-jis'),
  $B: repertoire('euc-jp', { multibyte: true, mapBytes: highHalf }),
  $A: repertoire('gbk', { multibyte: true, mapBytes: highHalf }),
  '$(D': repertoire('euc-jp', { multibyte: true, mapBytes: jisX0212Bytes }),
  '$)C': repertoire('euc-kr', { multibyte: true }),
  '$)A': repertoire('gbk', { multibyte: true }),
  ...Object.fromEntries(
    Object.entries(G1_LABELS).map(([final, label]) => [
      `-${final}`,
      repertoire(label),
    ])
  ),
};

/** Designations are two or three bytes wide, longest match first. */
const designationAt = (
  bytes: Uint8Array,
  at: number,
  table: Record<string, Repertoire>
) =>
  [3, 2]
    .map((width) => ({
      width,
      mode: table[String.fromCharCode(...bytes.subarray(at, at + width))],
    }))
    .find(({ mode }) => mode != null);

/**
 * Reads a value whose repertoire switches mid stream. Every run between two
 * escapes decodes under the repertoire the earlier escape designated, and a
 * delimiter returns a single byte repertoire to the default, as the standard
 * requires a writer to do explicitly.
 */
const decodeDesignations = (
  bytes: Uint8Array,
  initial: Repertoire,
  table: Record<string, Repertoire>
) => {
  const runs: string[] = [];
  let mode = initial;
  let start = 0;
  let at = 0;
  const flush = (end: number) => {
    if (end > start) runs.push(mode.decode(bytes.subarray(start, end)));
  };

  while (at < bytes.length) {
    const designation =
      bytes[at] === ESCAPE_BYTE
        ? designationAt(bytes, at + 1, table)
        : undefined;
    if (designation) {
      flush(at);
      mode = designation.mode;
      at += 1 + designation.width;
      start = at;
    } else {
      if (
        mode !== initial &&
        !mode.multibyte &&
        DELIMITER_BYTES.has(bytes[at])
      ) {
        flush(at);
        mode = initial;
        start = at;
      }
      at += 1;
    }
  }
  flush(bytes.length);
  return runs.join('');
};

/**
 * Value 1 of Specific Character Set is the default repertoire and values 2 and
 * up are extensions, so the last declared set is tried first and an earlier one
 * is used only for bytes it cannot decode. ISO 2022 IR 13 holds half width
 * katakana as raw bytes that the escape driven ISO 2022 IR 87 decoder rejects,
 * so no single decoder covers every value of such a file.
 */
export const characterSetDecoder = (specificCharacterSet: string[]) => {
  const declared = specificCharacterSet
    .filter((name) => name.trim().length > 0)
    .map(encodingLabel)
    .filter((label): label is string => label != null)
    .reverse();
  const labels = declared.length > 0 ? declared : ['utf-8'];
  const strict = labels.map((label) => new TextDecoder(label, { fatal: true }));
  const lenient = new TextDecoder(labels[0]);
  // JIS X 0201 has no backslash or tilde; those code points are the yen sign
  // and the overline, which is what GDCM emitted for such a file.
  const jisRoman = labels.includes('shift-jis');

  const initial: Repertoire = {
    decode: (bytes) =>
      strict.reduce<string | undefined>(
        (text, decoder) => text ?? tryDecode(decoder, bytes),
        undefined
      ) ?? lenient.decode(bytes),
    multibyte: false,
  };
  const table = { ...DESIGNATIONS, '(B': initial, '(J': initial };

  const decode = (raw: string) => {
    const bytes = toBytes(raw);
    return bytes.includes(ESCAPE_BYTE)
      ? decodeDesignations(bytes, initial, table)
      : initial.decode(bytes);
  };
  const repertoireText = (text: string) =>
    jisRoman ? text.replace(/\\/g, '\u00a5').replace(/~/g, '\u203e') : text;

  return {
    /** An element of value multiplicity 1, whose backslash is a character. */
    value: (raw: string) => repertoireText(decode(raw)),
    /**
     * A whole element's bytes, split into its values once decoded: byte 0x5c
     * delimits values only where it is not part of a multibyte character.
     */
    values: (raw: string) =>
      decode(raw).split(VALUE_DELIMITER).map(repertoireText),
  };
};
