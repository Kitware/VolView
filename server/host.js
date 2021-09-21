/* eslint-disable-next-line max-classes-per-file */
import WebsocketConnection from 'wslink/src/WebsocketConnection';
import { defer } from '../src/utils/common';

import { deserialize, serialize } from './serialize';

/**
 * Matches a response against valid type names
 */
function isValidResponse(response, types) {
  const rtype = response?.type;
  if (!types.includes(rtype)) {
    return false;
  }
  switch (rtype) {
    case 'rpc.result':
      return 'result' in response;
    case 'rpc.error':
      return 'error' in response;
    case 'rpc.deferred':
      return 'id' in response;
    case 'deferred.response':
      return 'id' in response && 'rpcResponse' in response;
    default:
      return false;
  }
}

export class RpcError extends Error {}

export default class HostConnection {
  constructor(wsUrl) {
    this.ws = null;
    this.wsUrl = wsUrl;
    this.connected = false;
    this.deferredResponses = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        this.ws = WebsocketConnection.newInstance({ urls: this.wsUrl });

        this.ws.onConnectionReady(() => {
          this.connected = true;
          this.session = this.ws.getSession();

          this.session.subscribe(
            'deferred.responses',
            this.handleDeferredResponse
          );

          resolve();
        });

        this.ws.onConnectionClose(() => {
          this.connected = false;
        });

        this.ws.onConnectionError(() => {
          reject(new Error('Failed to connect to ws endpoint'));
        });

        this.ws.connect();
      }
    });
  }

  async disconnect() {
    if (this.connected) {
      this.ws.destroy();
    }
  }

  async call(endpoint, ...args) {
    if (!this.connected) {
      throw new Error('Not connected');
    }

    const attach = (obj) => {
      if (ArrayBuffer.isView(obj) && !(obj instanceof DataView)) {
        return this.session.addAttachment(obj.buffer);
      }
      return obj;
    };

    const preparedArgs = args.map((arg) => serialize(arg, attach));

    const response = await this.session.call(endpoint, preparedArgs);
    return this.handleRpcResponse(response);
  }

  async handleRpcResponse(response) {
    if (
      !isValidResponse(response, ['rpc.result', 'rpc.error', 'rpc.deferred'])
    ) {
      throw new Error('Invalid response from rpc');
    }

    if (response.type === 'rpc.deferred') {
      const deferred = defer();
      this.deferredResponses.set(response.id, deferred);
      return deferred.promise;
    }

    if (response.type === 'rpc.error') {
      throw new RpcError(response.error);
    }

    const result = await deserialize(response.result);
    return result;
  }

  async handleDeferredResponse(response) {
    if (!isValidResponse(response, ['deferred.result'])) {
      throw new Error('Invalid deferred response');
    }

    const { id } = response;
    if (!this.deferredResponses.has(id)) {
      throw new Error('Received a deferred response for a nonexistent call');
    }

    const deferred = this.deferredResponses.get(id);
    this.deferredResponses.delete(id);

    try {
      const result = await this.handleRpcResponse(response.rpcResponse);
      deferred.resolve(result);
    } catch (e) {
      deferred.reject(e);
    }
  }
}
