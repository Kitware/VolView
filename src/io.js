import vtkXMLImageDataReader from 'vtk.js/Sources/IO/XML/XMLImageDataReader';
import vtkITKImageReader from 'vtk.js/Sources/IO/Misc/ITKImageReader';
import extensionToImageIO from 'itk/extensionToImageIO';
import readImageArrayBuffer from 'itk/readImageArrayBuffer';

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

export function readSingleFile(file) {
  return new Promise((resolve, reject) => {
    const { name } = file;
    const reader = getSingleFileReaderFor(getExtension(name));
    if (!reader) {
      throw new Error(`No reader for ${name}`);
    }

    const fio = new FileReader();
    fio.onload = () => {
      const ret = reader.parseFunc({ name, data: fio.result });
      Promise.resolve(ret).then(resolve).catch(reject);
    };

    const method = `readAs${reader.readFileAs}`;
    if (!fio[method]) {
      throw new Error(`Invalid reader for ${name}`);
    }

    fio[method](file);
  });
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
