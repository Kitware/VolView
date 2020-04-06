// How much data to read when extracting file magic
const HEAD_CHUNK = 512;

/**
 * special file types that we handle specifically
 */
export const FileTypes = {
  NRRD: 'nrrd',
  DICOM: 'dcm',
};

/**
 * file magic database
 * Used to handle certain cases where files have no extension
 */
export const FILE_MAGIC_DB = [
  {
    type: FileTypes.NRRD,
    header: Array.from('NRRD').map((c) => c.charCodeAt(0)),
  },
  {
    type: FileTypes.DICOM,
    skip: 128,
    header: Array.from('DICM').map((c) => c.charCodeAt(0)),
  },
];

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
 * Returns the file extension for a given filename
 * @param {String} name
 */
export function getFileExtension(name) {
  const idx = name.lastIndexOf('.');
  if (idx > -1) {
    return name.slice(idx + 1);
  }
  return '';
}

/**
 * Returns file type based on magic
 * @param {File} file
 */
export async function getFileMagic(file) {
  return new Promise((resolve, reject) => {
    const head = file.slice(0, HEAD_CHUNK);
    const reader = new window.FileReader();
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
    reader.readAsArrayBuffer(head);
  });
}

async function readFileAs(file, type) {
  return new Promise((resolve) => {
    const fio = new window.FileReader();
    fio.onload = () => resolve(fio.result);
    const method = `readAs${type}`;
    if (!fio[method]) {
      throw new TypeError(`readAs${type} is not a function`);
    }
    fio[method](file);
  });
}

/**
 * Reads a file and returns an ArrayBuffer
 * @param {File} file
 */
export async function readFileAsArrayBuffer(file) {
  return readFileAs(file, 'ArrayBuffer');
}

/**
 * Reads a file and returns UTF-8 text
 * @param {File} file
 */
export async function readFileAsUTF8Text(file) {
  return readFileAs(file, 'Text');
}

export class FileLoader {
  constructor() {
    this.fileReaders = Object.create(null);
    // Cache for file type. Prevents re-reading magic every time.
    this.typeCache = new WeakMap();
  }

  /**
   * Registers a file reader, which takes in a file and outputs a dataset.
   *
   * File type is treated case-insensitively.
   * @param {String} fileType the file type to handle
   * @param {Function} readerFunc a function with signature File -> (vtkObject|Promise<vtkObject>)
   */
  registerReader(fileType, readerFunc) {
    this.fileReaders[fileType.toLowerCase()] = readerFunc;
  }

  /**
   * Returns a reader for a file type
   * @param {String} fileType
   * @returns ReaderFunction|null
   */
  getReader(fileType) {
    return this.fileReaders[fileType.toLowerCase()] || null;
  }

  /**
   * Infers the file type from a file
   * @param {File} file
   * @returns String|null
   */
  async getFileType(file) {
    if (this.typeCache.has(file)) {
      return this.typeCache.get(file);
    }

    let type = null;

    const registeredTypes = Object.keys(this.fileReaders);
    for (let i = 0; i < registeredTypes.length; i += 1) {
      if (file.name.endsWith(registeredTypes[i])) {
        return registeredTypes[i];
      }
    }

    const extension = getFileExtension(file.name).toLowerCase();
    if (extension) {
      type = extension;
    } else {
      const magic = (await getFileMagic(file)).toLowerCase();
      if (magic) {
        type = magic;
      }
    }

    this.typeCache.set(file, type);
    return type;
  }

  /**
   * Determines if a file can be handled.
   * @param {File} file
   * @returns Boolean
   */
  async canRead(file) {
    const type = await this.getFileType(file);
    return !!this.fileReaders[type];
  }

  /**
   * Parses a single file to produce a single output dataset.
   *
   * @param {File} file
   * @returns vtkObject|null
   * @throws Error either the type info is not found or no reader is found
   */
  async parseFile(file) {
    const type = await this.getFileType(file);
    if (!type) {
      throw new Error(`No type info found for ${file.name}`);
    }

    const reader = this.fileReaders[type];
    if (!reader) {
      throw new Error(`No reader found for ${file.name}`);
    }

    return reader(file);
  }
}
