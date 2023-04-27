import Sinon from 'sinon';
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
  it('should execute a pipeline in order', async () => {
    const callOrder: number[] = [];

    const handlers: Array<Handler<void>> = [
      (input, { next }) => {
        callOrder.push(1);
        next();
      },
      (input, { next }) => {
        callOrder.push(2);
        next();
      },
      () => {
        callOrder.push(3);
      },
    ];
    const pipeline = new Pipeline<void>(handlers);
    const result = await pipeline.execute();

    expect(result.ok).to.be.true;
    expect(result.errors).to.have.length(0);
    expect(callOrder).to.deep.equal([1, 2, 3]);
  });

  it('should execute an async pipeline with transforms', async () => {
    let calc = 0;

    const handlers: Array<Handler<number>> = [
      async (input, { next }) => {
        await asyncSleep(1);
        next(input + 1);
      },
      (input, { next }) => {
        next(input + 2);
      },
      async (input) => {
        await asyncSleep(1);
        calc = input;
      },
    ];
    const pipeline = new Pipeline(handlers);
    const result = await pipeline.execute(5);

    expect(result.ok).to.be.true;
    expect(result.errors).to.have.length(0);
    expect(calc).to.equal(8);
  });

  it('should execute an asynchronous (async) pipeline without done', async () => {
    const callOrder: number[] = [];

    const handlers: Array<Handler<void>> = [
      async (input, { next }) => {
        await asyncSleep(1);
        callOrder.push(1);
        next();
      },
      async (input, { next }) => {
        await asyncSleep(1);
        callOrder.push(2);
        next();
      },
      async () => {
        await asyncSleep(1);
        callOrder.push(3);
      },
    ];
    const pipeline = new Pipeline<void>(handlers);
    const result = await pipeline.execute();

    expect(result.ok).to.be.true;
    expect(result.errors).to.have.length(0);
    expect(callOrder).to.deep.equal([1, 2, 3]);
  });

  it('should execute an asynchronous (promise) pipeline with done', async () => {
    const callOrder: number[] = [];

    const handlers: Array<Handler<void>> = [
      (input, { next }) => {
        return asyncSleep(1).then(() => {
          callOrder.push(1);
          next();
        });
      },
      (input, { next }) => {
        return asyncSleep(1).then(() => {
          callOrder.push(2);
          next();
        });
      },
      (input, context, done) => {
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

  it('should wait for done()', async () => {
    const spy = Sinon.spy();
    const handlers: Array<Handler<void>> = [
      (input, context, done) => {
        asyncSleep(1).then(() => {
          spy();
          done();
        });
      },
    ];
    const pipeline = new Pipeline<void>(handlers);
    const result = await pipeline.execute();

    expect(result.ok).to.be.true;
    expect(result.errors).to.have.length(0);
    expect(spy).to.have.been.calledOnce;
  });

  it('should correctly terminate early if an async handler does not return a promise', async () => {
    const spy = Sinon.spy();
    const handlers: Array<Handler<void>> = [
      // This handler doesn't return a promise, despite it being async!
      (_, { next }) => {
        asyncSleep(1).then(() => {
          next();
        });
      },
      () => {
        spy();
      },
    ];
    const pipeline = new Pipeline<void>(handlers);
    const result = await pipeline.execute();

    expect(result.ok).to.be.true;
    expect(result.errors).to.have.length(0);
    expect(spy).to.not.have.been.called;
  });

  it('should detect double next()', async () => {
    const handlers: Array<Handler<void>> = [
      (_, { next }) => {
        next();
        next();
      },
    ];
    const pipeline = new Pipeline<void>(handlers);
    const result = await pipeline.execute();

    expect(result.ok).to.be.false;
    expect(result.errors).to.have.length(1);
  });

  it('should detect double done()', async () => {
    const handlers: Array<Handler<void>> = [
      (input, ctxt, done) => {
        done();
        done();
      },
    ];
    const pipeline = new Pipeline<void>(handlers);
    const result = await pipeline.execute();

    expect(result.ok).to.be.false;
    expect(result.errors).to.have.length(1);
  });

  it('should detect mixed done() and next()', async () => {
    const handlers: Array<Handler<void>> = [
      (input, { next }, done) => {
        next();
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

  it('should handle nested async errors', async () => {
    const error = new Error('Some failure');
    const handlers: Array<Handler<number>> = [
      async (counter, { next }) => {
        if (counter === 0) {
          throw error;
        }
        await asyncSleep(1);
        next();
      },
      async (counter, { execute }) => {
        await asyncSleep(1);
        execute(counter - 1);
        if (counter > 1) {
          execute(counter - 2);
        }
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
