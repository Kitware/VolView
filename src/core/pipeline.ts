import { Awaitable } from '@vueuse/core';
import { defer, partition } from '../utils';

/**
 * Represents a pipeline error.
 *
 * The inputDataStackTrace property provides the inputs that caused the error.
 * It is ordered by nested level, starting with the inner most execution context
 * input.
 *
 * The cause property refers to the original thrown object that resulted in the
 * error.
 */
export interface PipelineError<DataType> {
  message: string;
  inputDataStackTrace: DataType[];
  cause: unknown;
}

/**
 * Represents a pipeline's execution result.
 *
 * The data property holds any return values from handlers.
 *
 * The errors property holds any errors reported from (potentially nested)
 * executions.
 */
export interface PipelineResult<DataType, ResultType> {
  ok: boolean;
  data: ResultType[];
  errors: PipelineError<DataType>[];
}

function createPipelineError<DataType>(
  message: string,
  input: DataType,
  cause: unknown
) {
  return {
    message,
    inputDataStackTrace: [input],
    cause,
  };
}

export interface IPipeline<DataType, ResultType> {
  /**
   * Runs a given input through a middleware pipeline.
   * @param input
   */
  execute(input: DataType): Promise<PipelineResult<DataType, ResultType>>;
}

const DoneSentinel: symbol = Symbol('DoneSentinel');
type DoneSentinelType = symbol;
export type Done<Out> = (out?: Out) => DoneSentinelType;

export interface PipelineContext<DataType, ResultType> {
  /**
   * Terminate the pipeline with an optional pipeline return value.
   * @param pipelineReturn
   */
  done: Done<ResultType>;
  /**
   * Execute the pipeline with the given input.
   * @param input
   */
  execute(input: DataType): Promise<PipelineResult<DataType, ResultType>>;
}

/**
 * Represents an element/step of a pipeline.
 *
 * Handlers have three pipeline operations availble to them:
 * - process input and produce output for the rest of the pipeline
 * - terminate the pipeline and optionally produce a result
 * - start a nested execution of the pipeline with new data
 *
 * Handlers receive input data via the `input` parameter and pass data down the
 * pipeline by returning. Pipeline execution will await asynchronous handlers if
 * they return a Promise that resolves to the output data.
 *
 * The second argument to a handler is a context object containing an
 * `execute()` method and a `done()` method.
 *
 * A handler is free to start new pipeline executions by calling
 * `execute(input)`.  The handler does not need to await the `execute` call, as
 * the top-level pipeline will track all nested executions.
 *
 * If a handler wishes to terminate the pipeline, it must call `done()`. This
 * will signal the pipeline to terminate after the handler returns.  An optional
 * pipeline result value can be passed as the single argument to `done(output)`.
 * If `done()` is signalled, then the handler's return value is ignored.
 *
 * To facilitate typing and to avoid accidentally forgetting to return a value
 * in a handler, handlers are typed to return either the DataType or the return
 * value of done().
 */
export type Handler<DataType, ResultType = void> = (
  input: DataType,
  context: PipelineContext<DataType, ResultType>
) => Awaitable<DataType | DoneSentinelType>;

/**
 * Represents an executable pipeline.
 *
 * Features supported:
 * - Execution of a pipeline in the given order of the provided handlers
 * - Handlers can run nested executions of the same pipeline
 * - Handlers can optionally transform data for downstream use
 * - Early termination
 * - Reporting errors. This includes un-nesting errors from nested executions.
 * - Reporting data returned from terminating handlers, if any.
 */
export default class Pipeline<DataType, ResultType = void>
  implements IPipeline<DataType, ResultType>
{
  private handlers: Handler<DataType, ResultType>[];

  constructor(handlers?: Handler<DataType, ResultType>[]) {
    this.handlers = Array.from(handlers ?? []);
  }

  /**
   * Executes the pipeline with a given input.
   *
   * This method will resolve once this execution context and all
   * nested execution contexts have finished, allowing for aggregate
   * error reporting.
   * @param input
   * @returns {PipelineResult}
   */
  async execute(input: DataType) {
    return this.startExecutionContext(input);
  }

  private async startExecutionContext(input: DataType) {
    const handlers = [...this.handlers];
    const nestedExecutions: Array<
      Promise<PipelineResult<DataType, ResultType>>
    > = [];
    const execution = defer<ResultType | void>();

    const terminate = (result: ResultType | void, error?: Error) => {
      if (error) {
        execution.reject(error);
      } else {
        execution.resolve(result);
      }
    };

    const invokeHandler = async (data: DataType, index: number) => {
      let doneInvoked = false;
      // eslint-disable-next-line no-undef-init
      let pipelineResult: ResultType | undefined = undefined;
      const endOfPipeline = index >= handlers.length;

      const context: PipelineContext<DataType, ResultType> = {
        done: (out?: ResultType): DoneSentinelType => {
          if (doneInvoked) {
            throw new Error('done() called twice!');
          }

          doneInvoked = true;
          pipelineResult = out;
          return DoneSentinel;
        },
        execute: async (arg: DataType) => {
          const promise = this.execute(arg);
          nestedExecutions.push(promise);
          return promise;
        },
      };

      let output: DataType | DoneSentinelType;

      if (endOfPipeline) {
        output = DoneSentinel;
      }

      try {
        if (endOfPipeline) {
          output = DoneSentinel;
        } else {
          const handler = handlers[index];
          output = await handler(data, context);
        }
      } catch (thrown) {
        const error =
          thrown instanceof Error
            ? thrown
            : new Error(thrown ? String(thrown) : 'Unknown error occurred');
        terminate(undefined, error);
        return;
      }

      if (doneInvoked || endOfPipeline) {
        terminate(pipelineResult);
        return;
      }

      invokeHandler(output as DataType, index + 1);
    };

    const result: PipelineResult<DataType, ResultType> = {
      ok: true,
      data: [],
      errors: [],
    };

    try {
      await invokeHandler(input, 0);
      const ret = await execution.promise;
      if (ret !== undefined) {
        result.data.push(ret);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.ok = false;
      result.errors.push(createPipelineError(message, input, err));
    }

    const innerResults = await Promise.all(nestedExecutions);
    const [succeededInner, failedInner] = partition(
      (res) => res.ok,
      innerResults
    );

    if (failedInner.length > 0) {
      result.ok = false;
    }

    succeededInner.forEach((okResult) => {
      result.data.push(...okResult.data);
    });

    failedInner.forEach((failedResult) => {
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
