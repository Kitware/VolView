/* eslint-disable */
import { defer, Deferred } from './index';

// to be used to instantiate a worker
export default class PromiseWorker {
  private msgID: number;
  private worker: Worker;
  private waiting: Record<string, Deferred<any>>;

  constructor(worker: Worker) {
    this.msgID = 0;
    this.worker = worker;
    this.waiting = {};

    this.worker.onmessage = this.handleMessage.bind(this);
  }

  postMessage(message: any, transferables: any[] = []) {
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

  handleMessage(ev: any) {
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
