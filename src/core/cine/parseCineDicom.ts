import dicomParser, { DataSet, Element } from 'dicom-parser';

// =================================================================
// Tag constants (dicom-parser format: 'xGGGGEEEE', lowercase hex)
// =================================================================

const TAG_PIXEL_DATA = 'x7fe00010';
const TAG_PATIENT_NAME = 'x00100010';
const TAG_PATIENT_ID = 'x00100020';
const TAG_PATIENT_BIRTH_DATE = 'x00100030';
const TAG_PATIENT_SEX = 'x00100040';
const TAG_STUDY_INSTANCE_UID = 'x0020000d';
const TAG_STUDY_DATE = 'x00080020';
const TAG_STUDY_TIME = 'x00080030';
const TAG_STUDY_ID = 'x00200010';
const TAG_ACCESSION_NUMBER = 'x00080050';
const TAG_STUDY_DESCRIPTION = 'x00081030';
const TAG_MODALITY = 'x00080060';
const TAG_SERIES_INSTANCE_UID = 'x0020000e';
const TAG_SERIES_NUMBER = 'x00200011';
const TAG_SERIES_DESCRIPTION = 'x0008103e';
const TAG_NUMBER_OF_FRAMES = 'x00280008';
const TAG_ROWS = 'x00280010';
const TAG_COLUMNS = 'x00280011';
const TAG_BITS_ALLOCATED = 'x00280100';
const TAG_SAMPLES_PER_PIXEL = 'x00280002';
const TAG_PHOTOMETRIC = 'x00280004';
const TAG_FRAME_TIME = 'x00181063';
const TAG_SEQUENCE_OF_ULTRASOUND_REGIONS = 'x00186011';
const TAG_PLANAR_CONFIGURATION = 'x00280006';

const TAG_PHYSICAL_UNITS_X = 'x00186024';
const TAG_PHYSICAL_UNITS_Y = 'x00186026';
const TAG_PHYSICAL_DELTA_X = 'x0018602c';
const TAG_PHYSICAL_DELTA_Y = 'x0018602e';

const TAG_TRANSFER_SYNTAX_UID = 'x00020010';

// =================================================================
// Public types
// =================================================================

type CineUltrasoundRegion = {
  physicalDeltaX: number | null;
  physicalDeltaY: number | null;
  physicalUnitsX: number | null;
  physicalUnitsY: number | null;
};

type CinePatientInfo = {
  PatientID: string;
  PatientName: string;
  PatientBirthDate: string;
  PatientSex: string;
};

type CineStudyInfo = {
  StudyID: string;
  StudyInstanceUID: string;
  StudyDate: string;
  StudyTime: string;
  AccessionNumber: string;
  StudyDescription: string;
};

type CineSeriesInfo = {
  SeriesInstanceUID: string;
  SeriesNumber: string;
  SeriesDescription: string;
  Modality: string;
};

export type CineHeader = {
  transferSyntaxUID: string;
  rows: number;
  cols: number;
  numberOfFrames: number;
  samplesPerPixel: number;
  bitsAllocated: number;
  planarConfiguration: number;
  photometricInterpretation: string;
  frameTimeMs: number | null;
  patient: CinePatientInfo;
  study: CineStudyInfo;
  series: CineSeriesInfo;
  regions: CineUltrasoundRegion[];
};

export type CineParseResult = {
  header: CineHeader;
  // Native: zero-copy view into the source buffer. Encapsulated: bytes for
  // one frame, possibly assembled from multiple fragments.
  frames: Uint8Array[];
  encapsulated: boolean;
};

// =================================================================
// Tag readers
// =================================================================

const str = (ds: DataSet, tag: string): string => (ds.string(tag) ?? '').trim();

const intStr = (ds: DataSet, tag: string): number => ds.intString(tag) ?? 0;

const u16 = (ds: DataSet, tag: string): number => ds.uint16(tag) ?? 0;

// VR=FD (PhysicalDeltaX/Y in ultrasound regions)
const readDouble = (ds: DataSet, tag: string): number | null => {
  const v = ds.double(tag);
  return v !== undefined && Number.isFinite(v) ? v : null;
};

// VR=DS (FrameTime, decimal string)
const readDecimalString = (ds: DataSet, tag: string): number | null => {
  const v = ds.floatString(tag);
  return v !== undefined && Number.isFinite(v) ? v : null;
};

function buildRegion(item: DataSet): CineUltrasoundRegion {
  return {
    physicalDeltaX: readDouble(item, TAG_PHYSICAL_DELTA_X),
    physicalDeltaY: readDouble(item, TAG_PHYSICAL_DELTA_Y),
    physicalUnitsX: u16(item, TAG_PHYSICAL_UNITS_X) || null,
    physicalUnitsY: u16(item, TAG_PHYSICAL_UNITS_Y) || null,
  };
}

// =================================================================
// PixelData extraction
// =================================================================

function extractEncapsulatedFrames(
  ds: DataSet,
  pd: Element,
  numberOfFrames: number
): Uint8Array[] {
  const bot = pd.basicOffsetTable ?? [];
  const fragments = pd.fragments ?? [];

  let offsets: number[];
  if (bot.length === numberOfFrames) {
    offsets = bot;
  } else if (fragments.length === numberOfFrames) {
    offsets = fragments.map((f) => f.offset);
  } else {
    // Empty BOT and fragments don't map 1:1 — scan for JPEG SOI markers.
    offsets = dicomParser.createJPEGBasicOffsetTable(ds, pd);
  }

  const frames: Uint8Array[] = [];
  for (let i = 0; i < numberOfFrames; i++) {
    // ByteArray = Uint8Array | Buffer in the TS shim; in browser it's always Uint8Array.
    frames.push(
      dicomParser.readEncapsulatedImageFrame(
        ds,
        pd,
        i,
        offsets,
        fragments
      ) as Uint8Array
    );
  }
  return frames;
}

function extractNativeFrames(
  ds: DataSet,
  pd: Element,
  numberOfFrames: number,
  frameBytes: number
): Uint8Array[] {
  const byteArray = ds.byteArray;
  const frames: Uint8Array[] = [];
  for (let i = 0; i < numberOfFrames; i++) {
    frames.push(
      new Uint8Array(
        byteArray.buffer,
        byteArray.byteOffset + pd.dataOffset + i * frameBytes,
        frameBytes
      )
    );
  }
  return frames;
}

// =================================================================
// Public entry point
// =================================================================

export function parseCineDicom(
  input: ArrayBuffer | Uint8Array
): CineParseResult {
  const u8 =
    input instanceof Uint8Array ? input : new Uint8Array(input as ArrayBuffer);
  const ds = dicomParser.parseDicom(u8);

  const pd = ds.elements[TAG_PIXEL_DATA];
  if (!pd) {
    throw new Error('PixelData (7FE0,0010) not found in DICOM file');
  }

  const numberOfFrames = intStr(ds, TAG_NUMBER_OF_FRAMES) || 1;
  const rows = u16(ds, TAG_ROWS);
  const cols = u16(ds, TAG_COLUMNS);
  const samplesPerPixel = u16(ds, TAG_SAMPLES_PER_PIXEL) || 1;
  const bitsAllocated = u16(ds, TAG_BITS_ALLOCATED) || 8;
  const planarConfiguration = u16(ds, TAG_PLANAR_CONFIGURATION);
  const transferSyntaxUID = str(ds, TAG_TRANSFER_SYNTAX_UID);

  const regionItems =
    ds.elements[TAG_SEQUENCE_OF_ULTRASOUND_REGIONS]?.items ?? [];
  const regions = regionItems
    .map((item) => item.dataSet)
    .filter((d): d is DataSet => !!d)
    .map(buildRegion);

  const header: CineHeader = {
    transferSyntaxUID,
    rows,
    cols,
    numberOfFrames,
    samplesPerPixel,
    bitsAllocated,
    planarConfiguration,
    photometricInterpretation: str(ds, TAG_PHOTOMETRIC),
    frameTimeMs: readDecimalString(ds, TAG_FRAME_TIME),
    patient: {
      PatientID: str(ds, TAG_PATIENT_ID),
      PatientName: str(ds, TAG_PATIENT_NAME),
      PatientBirthDate: str(ds, TAG_PATIENT_BIRTH_DATE),
      PatientSex: str(ds, TAG_PATIENT_SEX),
    },
    study: {
      StudyID: str(ds, TAG_STUDY_ID),
      StudyInstanceUID: str(ds, TAG_STUDY_INSTANCE_UID),
      StudyDate: str(ds, TAG_STUDY_DATE),
      StudyTime: str(ds, TAG_STUDY_TIME),
      AccessionNumber: str(ds, TAG_ACCESSION_NUMBER),
      StudyDescription: str(ds, TAG_STUDY_DESCRIPTION),
    },
    series: {
      SeriesInstanceUID: str(ds, TAG_SERIES_INSTANCE_UID),
      SeriesNumber: str(ds, TAG_SERIES_NUMBER),
      SeriesDescription: str(ds, TAG_SERIES_DESCRIPTION),
      Modality: str(ds, TAG_MODALITY),
    },
    regions,
  };

  const encapsulated = !!pd.encapsulatedPixelData;
  const frames = encapsulated
    ? extractEncapsulatedFrames(ds, pd, numberOfFrames)
    : extractNativeFrames(
        ds,
        pd,
        numberOfFrames,
        rows * cols * samplesPerPixel * Math.ceil(bitsAllocated / 8)
      );

  return { header, frames, encapsulated };
}

// =================================================================
// Supported transfer syntaxes
// =================================================================

const TRANSFER_SYNTAX_IMPLICIT_VR_LE = '1.2.840.10008.1.2';
const TRANSFER_SYNTAX_EXPLICIT_VR_LE = '1.2.840.10008.1.2.1';
const TRANSFER_SYNTAX_JPEG_BASELINE_1 = '1.2.840.10008.1.2.4.50';

const NATIVE_TRANSFER_SYNTAXES = new Set([
  TRANSFER_SYNTAX_IMPLICIT_VR_LE,
  TRANSFER_SYNTAX_EXPLICIT_VR_LE,
]);

const SUPPORTED_TRANSFER_SYNTAXES = new Set([
  ...NATIVE_TRANSFER_SYNTAXES,
  TRANSFER_SYNTAX_JPEG_BASELINE_1,
]);

export function isNativeTransferSyntax(uid: string): boolean {
  return NATIVE_TRANSFER_SYNTAXES.has(uid);
}

export function isSupportedCineTransferSyntax(uid: string): boolean {
  return SUPPORTED_TRANSFER_SYNTAXES.has(uid);
}
