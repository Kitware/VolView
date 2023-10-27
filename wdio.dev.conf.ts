import { config as baseConfig } from './wdio.chrome.conf';

const DEV_SERVER_PORT = '8080';

export const config = {
  ...baseConfig,
  baseUrl: `http://localhost:${DEV_SERVER_PORT}`,
  filesToWatch: ['./src/**/*.ts', './src/**/*.js', './src/**/*.vue'],
  // sample-rendering.e2e.ts does not work locally
  exclude: ['./tests/specs/sample-rendering.e2e.ts'],
};
