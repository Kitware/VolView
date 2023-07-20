import { config as configAwsSdk } from './lazyAwsSdk';
import { config as configJSZip } from './lazyJSZip';

interface Config {
  autoChunk: Array<RegExp>;
}

const configs = [configAwsSdk, configJSZip].filter(
  (config): config is Config => {
    const autoChunk = config?.autoChunk;
    if (!Array.isArray(autoChunk)) return false;
    return autoChunk.every((pattern) => pattern instanceof RegExp);
  }
);

/**
 * Determines if we should let rollup handle chunking on a given ID.
 *
 * Only runs on node_modules. See vite.config.ts for more info.
 */
export const shouldAutoChunk = (id: string) => {
  return configs.some((config) => {
    return config.autoChunk.some((pattern) => pattern.test(id));
  });
};
