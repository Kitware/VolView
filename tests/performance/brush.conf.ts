import path from 'node:path';
import { config as shared } from '../../wdio.chrome.conf';

export const config = {
  ...shared,
  specs: [path.resolve('tests/performance/brush.e2e.ts')],
  capabilities: shared.capabilities.map((capability) => ({
    ...capability,
    'goog:chromeOptions': {
      ...capability['goog:chromeOptions'],
      ...(process.env.BRUSH_BENCH_CHROME
        ? { binary: process.env.BRUSH_BENCH_CHROME }
        : {}),
    },
    ...(process.env.BRUSH_BENCH_CHROMEDRIVER
      ? {
          'wdio:chromedriverOptions': {
            binary: process.env.BRUSH_BENCH_CHROMEDRIVER,
          },
        }
      : {}),
  })),
  maxInstances: 1,
  services: shared.services?.map((service) =>
    Array.isArray(service) && service[0] === 'static-server'
      ? [
          service[0],
          {
            ...service[1],
            folders: service[1].folders.map(
              (folder: { mount: string; path: string }) =>
                folder.mount === '/'
                  ? {
                      ...folder,
                      path: path.resolve(
                        process.env.BRUSH_BENCH_DIST ?? 'dist'
                      ),
                    }
                  : folder
            ),
          },
        ]
      : service
  ),
  onComplete: async () => {},
  mochaOpts: {
    ...shared.mochaOpts,
    require: [path.resolve('tests/rootHooks.ts')],
    timeout: 300000,
  },
};
