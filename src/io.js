import vtkXMLImageDataReader from 'vtk.js/Sources/IO/XML/XMLImageDataReader';
import vtkITKImageReader from 'vtk.js/Sources/IO/Misc/ITKImageReader';
import extensionToImageIO from 'itk/extensionToImageIO';
import readImageArrayBuffer from 'itk/readImageArrayBuffer';

// How much data to read when extracting file magic
const HEAD_CHUNK = 512;

// file magic database
// Used to handle certain cases where files have no extension
const FILE_MAGIC_DB = [
  {
    type: 'nrrd',
    header: 'NRRD'.map((c) => c.charCodeAt(0)),
  },
  {
    type: 'dcm',
    skip: 128,
    header: 'DICM'.map((c) => c.charCodeAt(0)),
  },
];

vtkITKImageReader.setReadImageArrayBufferFromITK(readImageArrayBuffer);

const itkImageExtensions = Array.from(
  new Set(Array.from(extensionToImageIO.keys()).map((ext) => ext.toLowerCase())),
);

const singleReaders = {};
const dicomSeriesReader = null;

function registerSingleFileReader({ extension, readFileAs, parseFunc }) {
  singleReaders[extension.toLowerCase().trim('.')] = {
    readFileAs,
    parseFunc,
  };
}

function getSingleFileReaderFor(ext) {
  return singleReaders[ext.toLowerCase().trim('.')];
}

function getExtension(name) {
  const idx = name.lastIndexOf('.');
  if (idx > -1) {
    return name.slice(idx + 1);
  }
  return '';
}

function prefixEquals(target, prefix) {
  if (prefix.length > target.length) {
    return false;
  }
  for (let i = 0; i < prefix.length; i += 1) {
    if (prefix[i] !== target[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Returns file type based on magic
 * @param {File} file
 */
export function readFileMagic(file) {
  return new Promise((resolve, reject) => {
    const head = file.slice(0, HEAD_CHUNK);
    const reader = new FileReader();
    reader.onload = () => {
      const chunk = new Uint8Array(reader.result);
      for (let i = 0; i < FILE_MAGIC_DB.length; i += 1) {
        const { type, header, skip = 0 } = FILE_MAGIC_DB[i];
        if (prefixEquals(chunk.slice(skip), header)) {
          resolve(type);
          return;
        }
      }
      reject(new Error('Unknown file'));
    };
    reader.parseAsArrayBuffer(head);
  });
}

export async function readSingleFile(file) {
  const { name } = file;

  let type = getExtension(name);
  if (!type) {
    type = await readFileMagic(file);
  }

  const reader = getSingleFileReaderFor(type);
  if (!reader) {
    throw new Error(`No reader for ${name}`);
  }

  const readPromise = new Promise((resolve) => {
    const fio = new FileReader();
    fio.onload = async () => {
      const ret = await reader.parseFunc({ name, data: fio.result });
      resolve(ret);
    };

    const method = `readAs${reader.readFileAs}`;
    if (!fio[method]) {
      throw new Error(`Invalid reader for ${name}`);
    }

    fio[method](file);
  });

  return readPromise;
}

export function readDICOMSeries(files) {
  if (!dicomSeriesReader) {
    throw new Error('No DICOM series reader registered');
  }
  console.log(files);
}

registerSingleFileReader({
  extension: 'vti',
  readFileAs: 'ArrayBuffer',
  parseFunc: ({ data }) => {
    const reader = vtkXMLImageDataReader.newInstance();
    reader.parseAsArrayBuffer(data);
    return reader.getOutputData();
  },
});

itkImageExtensions.forEach((ext) => registerSingleFileReader({
  extension: ext,
  readFileAs: 'ArrayBuffer',
  parseFunc: ({ name, data }) => {
    const reader = vtkITKImageReader.newInstance();
    reader.setFileName(name);
    return reader.parseAsArrayBuffer(data).then(() => reader.getOutputData());
  },
}));

// registerDICOMSeriesReader({
// });
