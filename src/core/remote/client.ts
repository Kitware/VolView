import {
  DefaultDeserializeTransformers,
  DefaultSerializeTransformers,
  transformObject,
  transformObjects,
} from '@/src/core/remote/transformers';
import { Maybe } from '@/src/types';
import { Deferred, defer } from '@/src/utils';
import { debug } from '@/src/utils/loggers';
import pipe from '@/src/utils/pipe';
import { nanoid } from 'nanoid';
import { Socket, io } from 'socket.io-client';
import { z } from 'zod';
import * as ChunkedParser from '@/src/core/remote/chunkedParser';
import { URL } from 'whatwg-url';

const CLIENT_ID_SIZE = 24;
const RPC_ID_SIZE = 24;
const RPC_CALL_EVENT = 'rpc:call';
const RPC_RESULT_EVENT = 'rpc:result';
const STREAM_CALL_EVENT = 'stream:call';
const STREAM_RESULT_EVENT = 'stream:result';

interface RpcOkResult<R> {
  rpcId: string;
  ok: true;
  data: R;
}

const RpcOkResultSchema = z.object({
  rpcId: z.string(),
  ok: z.literal(true),
  data: z.unknown(),
});

export function makeRpcOkResult<T = unknown>(data: T): RpcOkResult<T> {
  return { rpcId: '', ok: true, data };
}

interface RpcErrorResult {
  rpcId: string;
  ok: false;
  error: string;
}

const RpcErrorResultSchema = z.object({
  rpcId: z.string(),
  ok: z.literal(false),
  error: z.string(),
});

export function makeRpcErrorResult(error: string): RpcErrorResult {
  return { rpcId: '', ok: false, error };
}

type RpcResult<R> = RpcOkResult<R> | RpcErrorResult;

const RpcResultSchema = z.union([RpcOkResultSchema, RpcErrorResultSchema]);

function validateRpcResult<T>(result: unknown): result is RpcResult<T> {
  return RpcResultSchema.safeParse(result).success;
}

interface StreamDataResult<R> extends RpcOkResult<R> {
  done: boolean;
}

const StreamDataResultSchema = RpcOkResultSchema.extend({
  done: z.boolean(),
});

type StreamResult<R> = StreamDataResult<R> | RpcErrorResult;

const StreamResultSchema = z.union([
  StreamDataResultSchema,
  RpcErrorResultSchema,
]);

function validateStreamResult<T>(result: unknown): result is StreamResult<T> {
  return StreamResultSchema.safeParse(result).success;
}

type StreamCallback<D> = (data: D) => void;

export interface RpcCall {
  rpcId: string;
  name: string;
  args?: unknown[];
}

const RpcCallSchema = z.object({
  rpcId: z.string(),
  name: z.string(),
  args: z.array(z.unknown()).optional(),
});

export function validateRpcCall(data: unknown): data is RpcCall {
  return RpcCallSchema.safeParse(data).success;
}

export interface RpcApi {
  [name: string]: (...args: any[]) => any;
}

export interface RpcClientOptions {
  serializers?: Array<(input: any) => any>;
  deserializers?: Array<(input: any) => any>;
  path?: string;
}

function justHostUrl(url: string) {
  const parts = new URL(url);
  parts.pathname = '';
  return String(parts);
}

function getSocketIoPath(url: string) {
  const parts = new URL(url);
  return parts.pathname.replace(/^\/+$/, '').length === 0
    ? '/socket.io/'
    : parts.pathname;
}

/**
 * Represents a bidirectional socket.io RPC client.
 */
export default class RpcClient {
  public readonly clientId: string;
  public readonly socket: Socket;
  public readonly api: RpcApi;

  public serializers = DefaultSerializeTransformers;
  public deserializers = DefaultDeserializeTransformers;

  private waiting: Map<string, Promise<unknown>>;
  private pendingRpcs: Map<string, Deferred<any>>;
  private activeStreams: Map<string, StreamCallback<any>>;

  constructor(api: RpcApi, options?: RpcClientOptions) {
    this.clientId = `cid_${nanoid(CLIENT_ID_SIZE)}`;
    this.api = api;
    this.serializers = options?.serializers ?? DefaultSerializeTransformers;
    this.deserializers =
      options?.deserializers ?? DefaultDeserializeTransformers;

    this.waiting = new Map();
    this.pendingRpcs = new Map();
    this.activeStreams = new Map();

    this.socket = io('', {
      query: {
        clientId: this.clientId,
      },
      autoConnect: false,
      parser: ChunkedParser,
    });

    this.socket.on(RPC_CALL_EVENT, this.onRpcCallEvent);
    this.socket.on(RPC_RESULT_EVENT, this.onRpcResultEvent);
    this.socket.on(STREAM_RESULT_EVENT, this.onStreamResultEvent);
  }

  protected serialize = (obj: any) => {
    return pipe(...this.serializers)(obj);
  };

  protected deserialize = (obj: any) => {
    return pipe(...this.deserializers)(obj);
  };

  async connect(uri: string) {
    await this.disconnect();
    // @ts-ignore reset socket.io URI
    this.socket.io.uri = justHostUrl(uri);
    this.socket.io.opts.path = getSocketIoPath(uri);

    let promise = this.waiting.get('connect');
    if (!promise) {
      promise = this.connectHelper();
      this.waiting.set('connect', promise);
      promise.finally(() => {
        this.waiting.delete('connect');
      });
    }
    return promise;
  }

  private connectHelper() {
    let resolve: () => void;
    let reject: (reason?: any) => void;

    const cleanup = () => {
      this.socket.off('connect', resolve);
      this.socket.off('connect_error', reject);
    };

    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
      this.socket.once('connect', resolve);
      this.socket.once('connect_error', reject);

      this.socket.connect();
    });
    promise.finally(cleanup);

    return promise;
  }

  async disconnect() {
    if (!this.socket.connected) {
      return Promise.resolve();
    }

    let promise = this.waiting.get('disconnect');
    if (!promise) {
      promise = new Promise<string>((resolve) => {
        this.socket.once('disconnect', resolve);
        this.socket.disconnect();
      });
      this.waiting.set('disconnect', promise);
      promise.finally(() => {
        this.waiting.delete('disconnect');
      });
    }
    return promise;
  }

  /**
   * Calls a remote RPC given some arguments.
   * @param rpcName
   * @param args
   */
  async call<R = unknown>(rpcName: string, args?: unknown[]) {
    if (!this.socket.connected) {
      throw new Error('Not connected to server');
    }

    const rpcId = `rpcid_${nanoid(RPC_ID_SIZE)}`;

    const pending = defer<R>();
    this.pendingRpcs.set(rpcId, pending);

    this.sendRpcCall(RPC_CALL_EVENT, {
      rpcId,
      name: rpcName,
      args: transformObjects(args ?? [], this.serialize),
    });

    return pending.promise;
  }

  private onRpcResultEvent = (result: RpcResult<unknown>) => {
    if (!validateRpcResult(result)) {
      // ignore invalid RPC responses
      debug.warn('Received invalid RPC result:', result);
      return;
    }

    const deferred = this.pendingRpcs.get(result.rpcId);
    if (!deferred) {
      // ignore untracked RPCs
      debug.warn('Received unknown RPC ID:', result.rpcId);
      return;
    }

    this.pendingRpcs.delete(result.rpcId);

    if (result.ok) {
      deferred.resolve(transformObject(result.data, this.deserialize));
    } else {
      deferred.reject(new Error(result.error));
    }
  };

  /**
   * Calls a remote streaming method.
   * @param methodName
   * @param callback
   */
  async stream<D>(
    methodName: string,
    callback: StreamCallback<D>
  ): Promise<void>;

  /**
   * Calls a remote streaming method.
   * @param methodName
   * @param args
   * @param callback
   */
  async stream<D>(
    methodName: string,
    args: unknown[],
    callback: StreamCallback<D>
  ): Promise<void>;

  async stream<D>(
    methodName: string,
    argsOrCallback: unknown[] | StreamCallback<D>,
    maybeCallback?: StreamCallback<D>
  ) {
    if (!this.socket.connected) {
      throw new Error('Not connected to server');
    }

    const args = Array.isArray(argsOrCallback) ? argsOrCallback : [];
    const callback = Array.isArray(argsOrCallback)
      ? maybeCallback!
      : argsOrCallback;

    const rpcId = `rpcid_${nanoid(RPC_ID_SIZE)}`;
    const deferred = defer<void>();

    this.pendingRpcs.set(rpcId, deferred);
    this.activeStreams.set(rpcId, callback);

    this.sendRpcCall(STREAM_CALL_EVENT, {
      rpcId,
      name: methodName,
      args: transformObjects(args ?? [], this.serialize),
    });

    return deferred.promise;
  }

  private onStreamResultEvent = (result: StreamResult<unknown>) => {
    if (!validateStreamResult(result)) {
      throw new Error('Failed to validate RPC stream result');
    }

    const deferred: Maybe<Deferred<void>> = this.pendingRpcs.get(result.rpcId);
    const callback = this.activeStreams.get(result.rpcId);
    if (!deferred || !callback) {
      // ignore untracked RPCs
      debug.warn('Received unknown RPC ID:', result.rpcId);
      return;
    }

    const clearListeners = () => {
      this.pendingRpcs.delete(result.rpcId);
      this.activeStreams.delete(result.rpcId);
    };

    if (result.ok) {
      if (result.done) {
        clearListeners();
        deferred.resolve();
      } else {
        callback(transformObject(result.data, this.deserialize));
      }
    } else {
      clearListeners();
      deferred.reject(new Error(result.error));
    }
  };

  protected sendRpcCall(eventType: string, payload: RpcCall) {
    this.socket.emit(eventType, payload);
  }

  protected onRpcCallEvent = async (rpcInfo: unknown) => {
    if (!validateRpcCall(rpcInfo)) {
      debug.warn('Received invalid RPC call:', rpcInfo);
      return;
    }

    const { rpcId, name, args } = rpcInfo;
    const result = await this.tryRpcCall(name, args ?? []);
    result.rpcId = rpcId;
    this.socket.emit(RPC_RESULT_EVENT, result);
  };

  protected async tryRpcCall(
    name: string,
    args: unknown[]
  ): Promise<RpcResult<unknown>> {
    if (!(name in this.api)) {
      return makeRpcErrorResult(
        `${name} is not a registered client RPC endpoint`
      );
    }

    try {
      const deserializedArgs = transformObjects(args, this.deserialize);
      type RpcMethod = (...args: unknown[]) => unknown;
      const data = await (this.api[name] as RpcMethod)(...deserializedArgs);
      return makeRpcOkResult(transformObject(data, this.serialize));
    } catch (err) {
      return makeRpcErrorResult(String(err));
    }
  }
}
