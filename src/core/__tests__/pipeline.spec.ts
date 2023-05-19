import sinonChai from 'sinon-chai';
import Chai, { expect } from 'chai';
import Pipeline, { Handler } from '../pipeline';

Chai.use(sinonChai);

function asyncSleep(msec: number) {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, msec);
  });
}

describe('Pipeline', () => {
  it('should execute a pipeline in order with results', async () => {
    const callOrder: number[] = [];

    const handlers: Array<Handler<void, number>> = [
      () => {
        callOrder.push(1);
      },
      () => {
        callOrder.push(2);
      },
      (input, { done }) => {
        callOrder.push(3);
        return done(42);
      },
    ];
    const pipeline = new Pipeline(handlers);
    const result = await pipeline.execute();

    expect(result.ok).to.be.true;
    expect(result.errors).to.have.length(0);
    expect(result.data).to.deep.equal([42]);
    expect(callOrder).to.deep.equal([1, 2, 3]);
  });

  it('should terminate a pipeline at the end without done', async () => {
    const callOrder: number[] = [];

    const handlers: Array<Handler<void, number>> = [
      () => {
        callOrder.push(1);
      },
      () => {
        callOrder.push(2);
      },
      () => {
        callOrder.push(3);
      },
    ];
    const pipeline = new Pipeline(handlers);
    const result = await pipeline.execute();

    expect(result.ok).to.be.true;
    expect(result.errors).to.have.length(0);
    expect(result.data).to.have.length(0);
    expect(callOrder).to.deep.equal([1, 2, 3]);
  });

  it('should execute an async pipeline with transforms', async () => {
    let calc = 0;

    const handlers: Array<Handler<number>> = [
      async (input) => {
        await asyncSleep(1);
        return input + 1;
      },
      (input) => {
        return input + 2;
      },
      async (input, { done }) => {
        await asyncSleep(1);
        calc = input;
        return done();
      },
    ];
    const pipeline = new Pipeline(handlers);
    const result = await pipeline.execute(5);

    expect(result.ok).to.be.true;
    expect(result.errors).to.have.length(0);
    expect(calc).to.equal(8);
  });

  it('should execute an asynchronous (promise) pipeline with done', async () => {
    const callOrder: number[] = [];

    const handlers: Array<Handler<void>> = [
      () => {
        return asyncSleep(1).then(() => {
          callOrder.push(1);
        });
      },
      () => {
        return asyncSleep(1).then(() => {
          callOrder.push(2);
        });
      },
      (input, { done }) => {
        return asyncSleep(1).then(() => {
          callOrder.push(3);
          done();
        });
      },
    ];
    const pipeline = new Pipeline<void>(handlers);
    const result = await pipeline.execute();

    expect(result.ok).to.be.true;
    expect(result.errors).to.have.length(0);
    expect(callOrder).to.deep.equal([1, 2, 3]);
  });

  it('should support a null result to done()', async () => {
    const handlers: Array<Handler<void, null>> = [
      (input, { done }) => {
        return asyncSleep(1).then(() => {
          done(null);
        });
      },
    ];
    const pipeline = new Pipeline(handlers);
    const result = await pipeline.execute();

    expect(result.ok).to.be.true;
    expect(result.errors).to.have.length(0);
    expect(result.data).to.deep.equal([null]);
  });

  it('should detect double done()', async () => {
    const handlers: Array<Handler<void>> = [
      (input, { done }) => {
        done();
        done();
      },
    ];
    const pipeline = new Pipeline<void>(handlers);
    const result = await pipeline.execute();

    expect(result.ok).to.be.false;
    expect(result.errors).to.have.length(1);
  });

  it('should handle top-level errors', async () => {
    const error = new Error('Some failure');
    const handlers: Array<Handler<void>> = [
      () => {
        throw error;
      },
    ];
    const pipeline = new Pipeline<void>(handlers);
    const result = await pipeline.execute();

    expect(result.ok).to.be.false;
    expect(result.errors).to.have.length(1);
    expect(result.errors[0].message).to.equal(error.message);
  });

  it('should handle top-level async errors', async () => {
    const error = new Error('Some failure');
    const handlers: Array<Handler<void>> = [
      async () => {
        asyncSleep(5);
        throw error;
      },
    ];
    const pipeline = new Pipeline<void>(handlers);
    const result = await pipeline.execute();

    expect(result.ok).to.be.false;
    expect(result.errors).to.have.length(1);
    expect(result.errors[0].message).to.equal(error.message);
  });

  it('should handle nested executions', async () => {
    // handlers encode fibonacci
    const handlers: Array<Handler<number, number>> = [
      async (idx, { done }) => {
        if (idx === 0 || idx === 1) {
          return done(1);
        }
        return idx;
      },
      async (idx, { execute, done }) => {
        let fnum = (await execute(idx - 1)).data[0];
        if (idx > 1) {
          fnum += (await execute(idx - 2)).data[0];
        }
        return done(fnum);
      },
    ];

    const pipeline = new Pipeline(handlers);
    const N = 5;
    const result = await pipeline.execute(N);

    expect(result.ok).to.be.true;
    // pick first result data, which is the top-level pipeline result
    expect(result.data[0]).to.equal(8);
  });

  it('should handle allow extra context overriding', async () => {
    type Extra = number;
    const handlers: Array<Handler<number, number, Extra>> = [
      (val, { done, execute, extra }) => {
        if (extra === 42) {
          return done(extra);
        }
        execute(val, 42);
        return val;
      },
    ];

    const pipeline = new Pipeline(handlers);
    const result = await pipeline.execute(0, 21);

    expect(result.ok).to.be.true;
    expect(result.data).to.deep.equal([42]);
  });

  it('should handle nested async errors', async () => {
    const error = new Error('Some failure');
    const handlers: Array<Handler<number>> = [
      async (counter) => {
        if (counter === 0) {
          throw error;
        }
        await asyncSleep(1);
        return counter;
      },
      async (counter, { execute, done }) => {
        await asyncSleep(1);
        execute(counter - 1);
        if (counter > 1) {
          execute(counter - 2);
        }
        return done();
      },
    ];

    // handlers encode fibonacci
    const pipeline = new Pipeline<number>(handlers);
    const N = 5;
    const result = await pipeline.execute(N);

    expect(result.ok).to.be.false;
    // we expect there to be fib(N+1) errors
    expect(result.errors).to.have.length(8);

    result.errors.forEach((err) => {
      const { message, inputDataStackTrace } = err;
      expect(message).to.equal(error.message);
      // first object should be the input passed to the erroring handler
      expect(inputDataStackTrace[0]).to.equal(0);
      // last object should be the input passed to the pipeline.
      expect(inputDataStackTrace.at(-1)).to.equal(N);
    });
  });
});
