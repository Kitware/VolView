import { mat3 } from 'gl-matrix';
import runPipelineBrowser from 'itk/runPipelineBrowser';
import { readFileAsArrayBuffer } from '@/src/io/io';
import IOTypes from 'itk/IOTypes';
import { defer } from '../utils/common';
import PriorityQueue from '../utils/priorityqueue';

export default class DicomIO {
  constructor() {
    this.webWorker = null;
    this.queue = new PriorityQueue();
    this.initializeCheck = null;
  }

  async addTask(module, args, inputs, outputs, priority = 0) {
    const deferred = defer();
    this.queue.push(
      {
        deferred,
        runArgs: [module, args, inputs, outputs],
      },
      priority
    );
    this.runTasks();
    return deferred.promise;
  }

  async runTasks() {
    if (this.tasksRunning) {
      return;
    }
    this.tasksRunning = true;

    while (this.queue.size()) {
      const { deferred, runArgs } = this.queue.pop();
      // we don't want parallelization. This is to work around
      // an issue in itk.js.
      // eslint-disable-next-line no-await-in-loop
      const result = await runPipelineBrowser(this.webWorker, ...runArgs);
      deferred.resolve(result);
    }

    this.tasksRunning = false;
  }

  /**
   * Helper that initializes the webworker.
   *
   * @async
   * @throws Error initialization failed
   */
  async initialize() {
    if (!this.initializeCheck) {
      this.initializeCheck = new Promise((resolve, reject) =>
        this.addTask('dicom', [], [], [])
          .then((result) => {
            if (result.webWorker) {
              this.webWorker = result.webWorker;
              resolve();
            } else {
              reject(new Error('Could not initialize webworker'));
            }
          })
          .catch(reject)
      );
    }
    return this.initializeCheck;
  }

  /**
   * Imports files
   * @async
   * @param {File[]} files
   * @returns VolumeID[] a list of volumes parsed from the files
   */
  async importFiles(files) {
    await this.initialize();

    const fileData = await Promise.all(
      files.map(async (file) => {
        const buffer = await readFileAsArrayBuffer(file);
        return {
          name: file.name,
          data: buffer,
        };
      })
    );

    const result = await this.addTask(
      // module
      'dicom',
      // args
      ['import', 'output.json', ...fileData.map((fd) => fd.name)],
      // outputs
      [{ path: 'output.json', type: IOTypes.Text }],
      // inputs
      fileData.map((fd) => ({
        path: fd.name,
        type: IOTypes.Binary,
        data: new Uint8Array(fd.data),
      }))
    );

    return JSON.parse(result.outputs[0].data);
  }

  /**
   * Builds the volume slice order.
   *
   * This should be done prior to readTags or buildVolume.
   * @param {String} volumeID
   */
  async buildVolumeList(volumeID) {
    const result = await this.addTask(
      'dicom',
      ['buildVolumeList', 'output.json', volumeID],
      [{ path: 'output.json', type: IOTypes.Text }],
      []
    );
    return JSON.parse(result.outputs[0].data);
  }

  /**
   * Reads a list of tags out from a given volume ID.
   *
   * @param {String} volumeID
   * @param {[]Tag} tags
   * @param {Integer} slice Defaults to 0 (first slice)
   */
  async readTags(volumeID, tags, slice = 0) {
    const tagsArgs = tags.map((t) => {
      const { strconv, tag } = t;
      return `${strconv ? '@' : ''}${tag}`;
    });

    const results = await this.addTask(
      'dicom',
      ['readTags', 'output.json', volumeID, String(slice), ...tagsArgs],
      [{ path: 'output.json', type: IOTypes.Text }],
      []
    );

    const json = JSON.parse(results.outputs[0].data) ?? {};
    return tags.reduce((info, t) => {
      const { tag, name } = t;
      if (tag in json) {
        return { ...info, [name]: json[tag] };
      }
      return info;
    }, {});
  }

  /**
   * Retrieves a slice of a series.
   * @async
   * @param {String} volumeID the volume ID
   * @param {Number} slice the slice to retrieve
   * @param {Boolean} asThumbnail cast image to unsigned char. Defaults to false.
   * @returns ItkImage
   */
  async getVolumeSlice(volumeID, slice, asThumbnail = false) {
    await this.initialize();

    const result = await this.addTask(
      'dicom',
      [
        'getSliceImage',
        'output.json',
        volumeID,
        String(slice),
        asThumbnail ? '1' : '0',
      ],
      [{ path: 'output.json', type: IOTypes.Image }],
      [],
      -10 // computing thumbnails is a low priority task
    );

    return result.outputs[0].data;
  }

  /**
   * Builds a volume for a given series.
   * @async
   * @param {String} volumeID the volume ID
   * @returns ItkImage
   */
  async buildVolume(volumeID) {
    await this.initialize();

    const result = await this.addTask(
      'dicom',
      ['buildVolume', 'output.json', volumeID],
      [{ path: 'output.json', type: IOTypes.Image }],
      [],
      10 // building volumes is high priority
    );

    // FIXME tranpose until itk.js consistently outputs col-major
    // and ITKHelper is updated.
    const image = result.outputs[0].data;
    mat3.transpose(image.direction.data, image.direction.data);
    return image;
  }

  /**
   * Deletes all files associated with a series.
   * @async
   * @param {String} volumeID the volume ID
   */
  async deleteVolume(volumeID) {
    await this.initialize();
    await this.addTask('dicom', ['deleteVolume', volumeID], [], []);
  }

  /**
   * Reads a TRE file.
   * @returns JSON
   */
  async readTRE(file) {
    await this.initialize();

    const fileData = {
      name: file.name,
      data: await readFileAsArrayBuffer(file),
    };

    const result = await this.addTask(
      // module
      'dicom',
      // args
      ['readTRE', 'output.json', file.name],
      // outputs
      [{ path: 'output.json', type: IOTypes.Text }],
      // inputs
      [
        {
          path: fileData.name,
          type: IOTypes.Binary,
          data: new Uint8Array(fileData.data),
        },
      ]
    );

    return JSON.parse(result.outputs[0].data);
  }
}
