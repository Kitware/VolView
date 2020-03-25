class WorkerHandler {
  constructor() {
    this.handler = null;
    onmessage = this.preHandler.bind(this);
  }

  registerHandler(func) {
    this.handler = func;
  }

  preHandler(ev) {
    if (this.handler) {
      const { id, message } = ev.data;

      let transferables = [];
      const setTransferables = (iter) => {
        transferables = Array.from(iter);
      };

      try {
        Promise.resolve(this.handler(message, setTransferables)).then((result) => {
          const msg = {
            id,
            message: result,
          };
          postMessage(msg, transferables);
        });
      } catch (error) {
        const msg = {
          id,
          error: error.message,
        };
        postMessage(msg);
      }
    }
  }
}

// To be used inside the worker
export default new WorkerHandler();
