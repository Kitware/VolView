import { Awaitable } from '@vueuse/core';
import { Maybe } from '@/src/types';
import { defer, partitionByType } from '../utils';

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

export interface PipelineResultSuccess<ResultType> {
  ok: true;
  data: ResultType[];
}

export interface PipelineResultError<DataType> {
  ok: false;
  errors: PipelineError<DataType>[];
}

/**
 * Represents a pipeline's execution result.
 *
 * The data property holds any return values from handlers.
 *
 * The errors property holds any errors reported from (potentially nested)
 * executions.
 */
export type PipelineResult<DataType, ResultType> =
  | PipelineResultSuccess<ResultType>
  | PipelineResultError<DataType>;

export const partitionResults = <T, U>(arr: Array<PipelineResult<T, U>>) =>
  partitionByType(
    (r: PipelineResult<T, U>): r is PipelineResultSuccess<U> => r.ok,
    arr
  );

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

export interface PipelineContext<DataType, ResultType, ExtraContext> {
  /**
   * Terminate the pipeline with an optional pipeline return value.
   * @param pipelineReturn
   */
  done: Done<ResultType>;
  /**
   * Execute the pipeline with the given input.
   * @param input
   */
  execute(
    input: DataType,
    extra?: ExtraContext
  ): Promise<PipelineResult<DataType, ResultType>>;
  /**
   * Register cleanup code
   * @param callback
   */
  onCleanup(callback: Function): void;
  /**
   * Any extra user-supplied data.
   */
  extra?: ExtraContext;
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
export type Handler<
  DataType,
  ResultType = undefined,
  ExtraContext = undefined
> = (
  input: DataType,
  context: PipelineContext<DataType, ResultType, ExtraContext>
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
export default class Pipeline<
  DataType,
  ResultType = undefined,
  ExtraContext = undefined
> implements IPipeline<DataType, ResultType>
{
  private handlers: Handler<DataType, ResultType, ExtraContext>[];

  constructor(handlers?: Handler<DataType, ResultType, ExtraContext>[]) {
    this.handlers = Array.from(handlers ?? []);
  }

  /**
   * Executes the pipeline with a given input.
   *
   * This method will resolve once this execution context and all
   * nested execution contexts have finished, allowing for aggregate
   * error reporting.
   *
   * Extra context data can be passed to all handlers via the `.extra` property.
   * In nested execution scenarios, handlers may choose to pass their own extra
   * context data into `execute(arg, extra)`. If none is supplied, the extra
   * context data from the outermost `execute()` call is used.
   *
   * @param input
   * @param extraContext
   * @returns {PipelineResult}
   */
  async execute(input: DataType, extraContext?: ExtraContext) {
    return this.startExecutionContext(input, extraContext);
  }

  private async startExecutionContext(
    input: DataType,
    extraContext?: ExtraContext
  ) {
    const handlers = [...this.handlers];
    const nestedExecutions: Array<
      Promise<PipelineResult<DataType, ResultType>>
    > = [];
    const execution = defer<Maybe<ResultType>>();
    const cleanupCallbacks: Function[] = [];

    const terminate = (result: Maybe<ResultType>, error?: Error) => {
      cleanupCallbacks.forEach((callback) => {
        try {
          callback();
        } catch (e) {
          console.error(e);
        }
      });

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

      const context: PipelineContext<DataType, ResultType, ExtraContext> = {
        done: (out?: ResultType): DoneSentinelType => {
          if (doneInvoked) {
            throw new Error('done() called twice!');
          }

          doneInvoked = true;
          pipelineResult = out;
          return DoneSentinel;
        },
        execute: async (arg: DataType, innerExtra?: ExtraContext) => {
          const promise = this.execute(arg, innerExtra ?? extraContext);
          nestedExecutions.push(promise);
          return promise;
        },
        onCleanup: (callback: Function) => {
          cleanupCallbacks.push(callback);
        },
        extra: extraContext,
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

    const result: PipelineResult<DataType, ResultType> = await (async () => {
      try {
        await invokeHandler(input, 0);
        const ret = await execution.promise;
        if (ret != null) {
          return {
            ok: true as const,
            data: [ret] as Array<ResultType>,
          };
        }
        return { ok: true as const, data: [] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false as const,
          errors: [createPipelineError(message, input, err)],
        };
      }
    })();

    const innerResults = await Promise.all(nestedExecutions);
    const [succeededInner, failedInner] = partitionResults(innerResults);

    if (failedInner.length > 0) {
      const errors = failedInner.flatMap((failedResult) => {
        const { errors: innerErrors } = failedResult;
        // add current input to the input stack trace
        innerErrors.forEach((err) => {
          err.inputDataStackTrace.push(input);
        });
        return innerErrors;
      });

      return {
        ok: false as const,
        errors,
      };
    }

    if (result.ok) {
      succeededInner.forEach((okResult) => {
        result.data.push(...okResult.data);
      });
    }

    return result;
  }
}
