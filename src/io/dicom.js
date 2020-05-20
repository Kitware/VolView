import runPipelineBrowser from 'itk/runPipelineBrowser';
import { readFileAsArrayBuffer } from '@/src/io/io';
import IOTypes from 'itk/IOTypes';

export default class DicomIO {
  constructor() {
    this.webWorker = null;
  }

  /**
   * Helper that initializes the webworker.
   *
   * @async
   * @throws Error initialization failed
   */
  async initialize() {
    const result = await runPipelineBrowser(this.webWorker, 'dicom', [], [], []);
    if (result.webWorker) {
      this.webWorker = result.webWorker;
    } else {
      throw new Error('Could not initialize webworker');
    }
  }

  /**
   * Imports files
   * @async
   * @param {File[]} files
   * @returns SeriesUIDs and series information
   */
  async importFiles(files) {
    if (!this.webWorker) {
      throw new Error('DicomIO: initialize not called');
    }

    const fileData = await Promise.all(files.map(async (file) => {
      const buffer = await readFileAsArrayBuffer(file);
      return {
        name: file.name,
        data: buffer,
      };
    }));

    const result = await runPipelineBrowser(
      this.webWorker,
      // module
      'dicom',
      // args
      [
        'import', 'output.json', ...fileData.map((fd) => fd.name),
      ],
      // outputs
      [{ path: 'output.json', type: IOTypes.Text }],
      // inputs
      fileData.map((fd) => ({
        path: fd.name,
        type: IOTypes.Binary,
        data: new Uint8Array(fd.data),
      })),
    );

    if (result.webWorker) {
      this.webWorker = result.webWorker;
    }

    return JSON.parse(result.outputs[0].data);
  }

  /**
   * Generates a thumbnail image for a series
   * @async
   * @param {String} seriesUID
   * @returns ImageData
   */
  async generateThumbnail(seriesUID) {
    if (!this.webWorker) {
      throw new Error('DicomIO: initialize not called');
    }

    const result = await runPipelineBrowser(
      this.webWorker,
      'dicom',
      ['thumbnail', 'output.json', seriesUID],
      [{ path: 'output.json', type: IOTypes.Image }],
      [],
    );

    return result.outputs[0].data;
  }
}
