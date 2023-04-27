import { defer } from '../utils';

export interface PipelineError<T> {
  message: string;
  inputDataStackTrace: T[];
  cause: unknown;
}

export interface PipelineResult<T> {
  ok: boolean;
  errors: PipelineError<T>[];
}

function createPipelineError<T>(message: string, input: T, cause: unknown) {
  return {
    message,
    inputDataStackTrace: [input],
    cause,
  };
}

export interface IPipeline<T> {
  /**
   * Runs a given input through a middleware pipeline.
   * @param input
   */
  execute(input: T): Promise<PipelineResult<T>>;
}

export interface PipelineContext<T> {
  next(out?: T): void;
  execute(input: T): Promise<PipelineResult<T>>;
}

/**
 * Handles an input in a pipeline.
 *
 * If a handler does not call next, the pipeline terminates.
 *
 * A handler can optionally pass in a transformed output to `next(newInput)`.
 *
 * A handler is free to start new pipeline executions by calling `execute(input)`.
 * The handler can optionally await the `execute` call if it so desires. The
 * top-level pipeline will track all nested executions.
 *
 * If a handler specifies a third and optional `done` parameter, then the pipeline
 * will wait for the handler to call `done` before terminating, rather than awaiting
 * for the function to return.
 *
 * If a handler does not use the optional "done" parameter, it must register all
 * `execute` calls prior to returning, otherwise they will not be tracked.
 * For asynchronous handlers, this means using async/await in order to register
 * all `execute` calls.
 */

export type Done = () => void;

export type Handler<T> = (
  input: T,
  context: PipelineContext<T>,
  done: Done
) => void;

export default class Pipeline<T> implements IPipeline<T> {
  private handlers: Handler<T>[];

  constructor(handlers?: Handler<T>[]) {
    this.handlers = Array.from(handlers ?? []);
  }

  /**
   * Executes the pipeline with a given input.
   *
   * This method will resolve once this execution context and all
   * nested execution contexts have finished, allowing for aggregate
   * error reporting.
   * @param input
   */
  async execute(input: T) {
    return this.startExecutionContext(input);
  }

  private async startExecutionContext(input: T) {
    const handlers = [...this.handlers];
    const nestedExecutions: Array<Promise<PipelineResult<T>>> = [];
    const execution = defer<void>();

    const terminate = (error?: Error) => {
      if (error) {
        execution.reject(error);
      } else {
        execution.resolve();
      }
    };

    const invokeHandler = async (data: T, index: number) => {
      if (index >= handlers.length) {
        return;
      }

      let nextInvoked = false;
      let doneInvoked = false;

      const context: PipelineContext<T> = {
        next: (out?: T) => {
          if (nextInvoked) {
            throw new Error('next() called twice in a pipeline handler!');
          }

          nextInvoked = true;
          invokeHandler(out ?? data, index + 1);
        },
        execute: async (arg: T) => {
          const promise = this.execute(arg);
          nestedExecutions.push(promise);
          return promise;
        },
      };

      const deferredDone = defer<void>();

      const done = () => {
        if (doneInvoked) {
          throw new Error('done() called twice!');
        }
        if (nextInvoked) {
          throw new Error('done() and next() called in the same handler!');
        }

        doneInvoked = true;
        deferredDone.resolve();
      };

      const handler = handlers[index];
      const expectDoneCallback = handler.length === 3;

      try {
        await handler(data, context, done);
      } catch (thrown) {
        const error =
          thrown instanceof Error
            ? thrown
            : new Error(thrown ? String(thrown) : 'Unknown error occurred');
        terminate(error);
        return;
      }

      if (expectDoneCallback) {
        await deferredDone.promise;
        terminate();
        return;
      }

      if (nextInvoked && doneInvoked) {
        throw new Error('done() and next() called in the same handler!');
      }

      // returning without next() means to finish
      if (!nextInvoked) {
        terminate();
      }
    };

    const result: PipelineResult<T> = {
      ok: true,
      errors: [],
    };

    try {
      await invokeHandler(input, 0);
      await execution.promise;
    } catch (err) {
      result.ok = false;
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(createPipelineError(message, input, err));
    }

    const innerResults = await Promise.all(nestedExecutions);
    const failedInnerResults = innerResults.filter((res) => !res.ok);

    if (failedInnerResults.length > 0) {
      result.ok = false;
    }

    failedInnerResults.forEach((failedResult) => {
      const { errors } = failedResult;

      // add current input to the input stack trace
      errors.forEach((err) => {
        err.inputDataStackTrace.push(input);
      });

      result.errors.push(...errors);
    });

    return result;
  }
}
