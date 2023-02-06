import { Maybe } from '@/src/types';
import { Deferred, defer } from '@/src/utils';
import { nanoid } from 'nanoid';
import { Socket, io } from 'socket.io-client';
import { z } from 'zod';

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

/**
 * Represents a bidirectional socket.io RPC client.
 *
 * TODO: are listeners cleared after the socket disconnects?
 */
export default class RpcClient {
  protected clientId: string;
  protected socket: Socket;

  private waiting: Map<string, Promise<unknown>>;
  private pendingRpcs: Map<string, Deferred<any>>;
  private activeStreams: Map<string, StreamCallback<any>>;

  constructor(url: string) {
    this.clientId = `cid_${nanoid(CLIENT_ID_SIZE)}`;
    this.waiting = new Map();
    this.pendingRpcs = new Map();
    this.activeStreams = new Map();

    this.socket = io(url, {
      query: {
        clientId: this.clientId,
      },
      autoConnect: false,
    });

    this.socket.on(RPC_RESULT_EVENT, this.onRpcResultEvent.bind(this));
    this.socket.on(STREAM_RESULT_EVENT, this.onStreamResultEvent.bind(this));
  }

  async connect() {
    if (this.socket.connected) {
      return Promise.resolve();
    }

    let promise = this.waiting.get('connect');
    if (!promise) {
      promise = this.connectHelper();
      this.waiting.set('connect', promise);
    }
    return promise;
  }

  private connectHelper() {
    let resolve: () => void;
    let reject: (reason?: any) => void;
    const cancel = () => {
      this.socket.off('connect', resolve);
      this.socket.off('connect', reject);
    };

    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
      this.socket.once('connect', resolve);
      this.socket.once('connect_error', reject);

      this.socket.connect();
    });

    promise.then(cancel);
    promise.catch(cancel);

    return promise;
  }

  async disconnect() {
    if (this.socket.disconnected) {
      return Promise.resolve();
    }

    let promise = this.waiting.get('disconnect');
    if (!promise) {
      promise = new Promise<string>((resolve) => {
        this.socket.once('disconnect', resolve);
        this.socket.disconnect();
      });
      this.waiting.set('disconnect', promise);
    }
    return promise;
  }

  /**
   * Calls a remote RPC given some arguments.
   * @param rpcName
   * @param args
   */
  async call<R = unknown>(rpcName: string, args?: unknown[]) {
    await this.connect();

    const rpcId = `rpcid_${nanoid(RPC_ID_SIZE)}`;

    const pending = defer<R>();
    this.pendingRpcs.set(rpcId, pending);

    this.sendRpcCall(RPC_CALL_EVENT, {
      rpcId,
      name: rpcName,
      args,
    });

    return pending.promise;
  }

  private onRpcResultEvent(result: RpcResult<unknown>) {
    if (!validateRpcResult(result)) {
      throw new Error('Failed to validate RPC result');
    }

    const deferred = this.pendingRpcs.get(result.rpcId);
    if (!deferred) {
      // ignore untracked RPCs
      return;
    }

    this.pendingRpcs.delete(result.rpcId);

    if (result.ok) {
      deferred.resolve(result.data);
    } else {
      deferred.reject(new Error(result.error));
    }
  }

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
    await this.connect();

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
      args,
    });

    return deferred.promise;
  }

  private onStreamResultEvent(result: StreamResult<unknown>) {
    if (!validateStreamResult(result)) {
      throw new Error('Failed to validate RPC stream result');
    }

    const deferred: Maybe<Deferred<void>> = this.pendingRpcs.get(result.rpcId);
    const callback = this.activeStreams.get(result.rpcId);
    if (!deferred || !callback) {
      // ignore untracked RPCs
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
        callback(result.data);
      }
    } else {
      clearListeners();
      deferred.reject(new Error(result.error));
    }
  }

  protected sendRpcCall(eventType: string, payload: RpcCall) {
    this.socket.emit(eventType, payload);
  }
}
