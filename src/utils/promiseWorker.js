import { defer } from './common';

// to be used to instantiate a worker
export default class PromiseWorker {
  constructor(Worker) {
    this.msgID = 0;
    this.worker = new Worker();
    this.waiting = {};

    this.worker.onmessage = this.handleMessage.bind(this);
  }

  postMessage(message, transferables = []) {
    const wrappedMsg = {
      id: this.msgID,
      message,
    };

    const deferred = defer();
    this.waiting[wrappedMsg.id] = deferred;

    this.worker.postMessage(wrappedMsg, transferables);

    this.msgID += 1;
    return deferred.promise;
  }

  handleMessage(ev) {
    const { id, error, message } = ev.data;
    if (id in this.waiting) {
      const deferred = this.waiting[id];
      delete this.waiting[id];
      if (error) {
        deferred.reject(new Error(error));
      } else {
        deferred.resolve(message);
      }
    }
  }
}
