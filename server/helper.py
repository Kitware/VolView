import wslink
from wslink.websocket import LinkProtocol


RPC_DEFERRED_TYPE = 'rpc.deferred'
RPC_RESULT_TYPE = 'rpc.result'
RPC_ERROR_TYPE = 'rpc.error'
DEFERRED_RESPONSE_TYPE = 'deferred.response'


class FutureResult(object):
    def __init__(self, id):
        self._id = id
        self._done = False
        self._result = None
        self._exception = None
        self._callbacks = []

    def id(self):
        return self._id

    def done(self):
        return self._done

    def result(self):
        if not self._done:
            raise Exception('Future is not done')
        return self._result

    def exception(self):
        if not self._done:
            raise Exception('Future is not done')
        return self._exception

    def has_result(self):
        return self._done and bool(self._result)

    def has_exception(self):
        return self._done and bool(self._exception)

    def add_done_callback(self, cb):
        self._callbacks.append(cb)

    def remove_done_callback(self, cb):
        self._callbacks.remove(cb)

    def set_result(self, result):
        if not self._done:
            self._done = True
            self._result = result
            self._trigger_callbacks()

    def set_exception(self, exception):
        if not self._done:
            self._done = True
            self._exception = exception
            self._trigger_callbacks()

    def _trigger_callbacks(self):
        for cb in self._callbacks:
            try:
                cb(self)
            except:
                pass


def make_deferred_response(future):
    return {
        'type': RPC_DEFERRED_TYPE,
        'id': future.id(),
    }


def make_result_response(result):
    return {
        'type': RPC_RESULT_TYPE,
        'result': result,
    }


def make_error_response(exc):
    return {
        'type': RPC_ERROR_TYPE,
        'error': str(exc),
    }


def make_deferred_result_response(future):
    if not future.done():
        raise Exception('Future result is not done')

    if future.has_exception():
        return {
            'type': DEFERRED_RESPONSE_TYPE,
            'id': future.id(),
            'rpcResponse': make_error_response(future.exception())
        }
    return {
        'type': DEFERRED_RESPONSE_TYPE,
        'id': future.id(),
        'rpcResponse': make_result_response(future.result())
    }


def rpc(name):
    def wrapper(fn):
        def handler(self, *args, **kwargs):
            # deserialize args, kwargs

            try:
                result = fn(self, *args, **kwargs)

                if type(result) is FutureResult:
                    self._futures.append(result)
                    result.set_done_callback(self._handle_future_result)
                    return make_deferred_response(result.id())

                return make_result_response(result)
            except Exception as e:
                return make_error_response(e)

        return wslink.register(name)(handler)
    return wrapper


class RpcApi(LinkProtocol):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._futures = []

    def _handle_future_result(self, future):
        self._futures.remove(future)
        self.publish('deferred.responses',
                     make_deferred_result_response(future))
