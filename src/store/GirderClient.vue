/* eslint-disable no-underscore-dangle */
import axios from 'axios';
import cookies from 'js-cookie';

export default class GirderClient {
  constructor(config) {
    // Setup base request instance
    const url = `http://${config.ip}:${config.port}/api/${config.version}`;
    this.rest = axios.create({
      baseURL: url,
      timeout: config.timeout,
    });

    // Add Girder token to request instance if present in cookies
    this.addRequestDefaultTokenFromCookies();

    // Caching of case data
    this.caseFolder = null;
    this.inputItem = null;
    this.outputItem = null;
  }

  addRequestDefaultTokenFromCookies() {
    this.rest.defaults.headers.common['Girder-Token'] = cookies.get('girderToken');
  }

  static processRequest(request) {
    return request.then((response) => response.data)
      .catch((error) => {
        if (error.response) {
          // The request was made and the server responded with a status code
          // that falls out of the range of 2xx
          console.log(error.response.data);
        }
        if (error.request) {
          // The request was made but no response was received
          // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
          // http.ClientRequest in node.js
          console.log(error.request);
        }
        throw error;
      });
  }

  waitForJobCompletion(job) {
    // Polling mechanism to track asynchronous girder jobs
    // See https://github.com/girder/girder_web_components/blob/master/src/utils/notifications.js
    const min = 200;
    const max = 1000;
    const step = 500;
    let interval = 0;
    let date = job.created;
    let log = '';

    const self = this;
    return new Promise((resolve, reject) => {
      async function poll() {
        const config = { since: date };
        const { data } = await self.rest.get('/notification', config);
        if (data.length) {
          // Iterate through notifications
          for (let i = 0; i < data.length; i += 1) {
            const notif = data[i];
            //  Look at notifications for the current job
            if (notif.data._id === job._id) {
              if (notif.type === 'job_log') {
                // Keep track of the log for that job
                log += `${notif.data.text}\n`;
              } else if (notif.type === 'job_status') {
                // Job status enum
                // See https://github.com/girder/girder_web_components/blob/master/src/components/Job/status.js
                switch (notif.data.status) {
                  case 3: // success
                    resolve();
                    return;
                  case 4: // error
                    reject(new Error(log === '' ? `Asynchronous job ${job._id} failed` : log));
                    return;
                  case 5: // cancel
                    reject(new Error(`Asynchronous job ${job._id} was canceled`));
                    return;
                  default:
                    break;
                }
              }
              // If not completed, update the date to only query
              // more recent notifications on the next call
              date = new Date(notif.time);
              date.setMilliseconds(date.getMilliseconds() + 1);
              date = date.toISOString();
            }
          }
          interval = min;
        } else {
          interval = Math.min(interval + step, max);
        }

        // Recursive call
        setTimeout(poll, interval);
      }

      // First call
      setTimeout(poll, interval);
    });
  }

  /* Authentication */

  async login(username, password) {
    const config = {
      auth: {
        username,
        password,
      },
      headers: { 'Girder-Token': null },
    };

    const request = this.rest.get('/user/authentication', config);
    return GirderClient.processRequest(request).then((data) => {
      // Save token in cookies
      cookies.set('girderToken', data.authToken.token);
      this.addRequestDefaultTokenFromCookies();
      return data;
    });
  }

  /* Create */

  createCase() {
    const config = {
      headers: { 'Content-Type': 'application/json' },
    };

    const request = this.rest.post('/case', null, config);
    return GirderClient.processRequest(request).then((data) => {
      // Cache case info
      Object.assign(this, data);
      return data;
    });
  }

  /* Delete */

  deleteCase() {
    const endpoint = `/case/${this.caseFolder._id}`;
    const request = this.rest.delete(endpoint);
    return GirderClient.processRequest(request);
  }

  /* Upload */

  upload(files, progressCallback) {
    // Logic to group the progress for all files
    const progressDict = {};
    function fileProgressCallback(filename, progress) {
      progressDict[filename] = progress;
      const progressList = Object.values(progressDict);
      const p = progressList.reduce((sum, value) => sum + value) / progressList.length;
      progressCallback(p);
    }

    // Method to upload one file
    // const self = this;
    const upload = (file, item) => {
      const config = {
        params: {
          parentType: item._modelType,
          parentId: item._id,
          name: file.name,
          size: file.size,
          mimeType: file.type,
        },
        headers: { 'Content-type': 'application/dicom' },
      };
      if (typeof progressCallback === 'function') {
        progressDict[file.name] = 0;
        config.onUploadProgress = (e) => {
          const p = Math.round((e.loaded * 100) / e.total);
          fileProgressCallback(file.name, p);
        };
      }

      const request = this.rest.post('/file', file, config);
      return GirderClient.processRequest(request);
    };

    // Resolve all promises
    const uploadPromises = [
      ...files.map((file) => upload(file, this.inputItem)),
    ];
    return Promise.all(uploadPromises);
  }

  /* Process */

  process() {
    const endpoint = `/case/${this.caseFolder._id}/process`;
    const config = {
      headers: { 'Content-type': 'application/json' },
    };
    const request = this.rest.put(endpoint, null, config);
    return GirderClient.processRequest(request);

    // If a job, use this:
    //return GirderClient.processRequest(request)
    //  .then((job) => this.waitForJobCompletion(job));
  }
}
