// Mocha root hooks, loaded through mochaOpts.require. They fail a test for
// trouble a spec would otherwise sail past: a page that reaches the internet,
// or a WebGL error.

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const NETWORK_PROTOCOLS = ['http:', 'https:', 'ws:', 'wss:'];

const WEBGL_FAILURES = [
  'Error compiling shader',
  'CONTEXT_LOST_WEBGL',
  "reading 'setContext'",
];

let subscribedSession = '';
const externalRequests: string[] = [];
const webglErrors: string[] = [];

// A spec that must reach an address compiled into the app swaps it in the
// page with addInitScript. A network intercept or mock stalls the app's
// data loading, even one that matches nothing.
const isExternal = (rawUrl: string) => {
  const url = new URL(rawUrl);
  return (
    NETWORK_PROTOCOLS.includes(url.protocol) &&
    !LOCAL_HOSTS.includes(url.hostname)
  );
};

function listen() {
  browser.on('log.entryAdded', (entry) => {
    const text = entry.text ?? '';
    console.log(`[Browser Console] [${entry.level}] ${text}`);
    if (WEBGL_FAILURES.some((failure) => text.includes(failure))) {
      webglErrors.push(text);
    }
  });
  browser.on('network.beforeRequestSent', (event) => {
    if (isExternal(event.request.url)) {
      externalRequests.push(event.request.url);
    }
  });
}

// reloadSession starts a session that has no subscriptions.
async function subscribe() {
  if (subscribedSession === browser.sessionId) return;
  if (!subscribedSession) listen();
  subscribedSession = browser.sessionId;
  await browser.sessionSubscribe({
    events: ['log.entryAdded', 'network.beforeRequestSent'],
  });
}

export const mochaHooks = {
  // Before a spec's own before hook, which may already load the page.
  async beforeAll() {
    await subscribe();
  },

  async beforeEach() {
    await subscribe();
  },

  afterEach() {
    const requested = externalRequests.splice(0);
    const failed = webglErrors.splice(0);
    if (requested.length) {
      throw new Error(
        `The page requested non-local URLs:\n${requested.join('\n')}`
      );
    }
    if (failed.length) {
      throw new Error(`WebGL failed during the test:\n${failed.join('\n')}`);
    }
  },
};
