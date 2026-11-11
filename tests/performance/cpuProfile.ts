/** Chrome's sampling profiler is optional so normal observations need no debugger. */
export async function connectProfiler(debuggerAddress: string) {
  const targets: { type: string; url: string; webSocketDebuggerUrl: string }[] =
    await (await fetch(`http://${debuggerAddress}/json/list`)).json();
  const target = targets.find(
    (item) => item.type === 'page' && item.url.startsWith('http://localhost:')
  );
  if (!target)
    throw new Error(
      'The benchmark page is missing from Chrome debugger targets'
    );
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
  >();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const send = (method: string) =>
    new Promise<unknown>((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method }));
    });
  await send('Profiler.enable');
  return {
    start: () => send('Profiler.start'),
    stop: async () => (await send('Profiler.stop')) as { profile: unknown },
    close: () => socket.close(),
  };
}
