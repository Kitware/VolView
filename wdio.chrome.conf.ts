import { config } from './wdio.shared.conf';

config.capabilities = [
  {
    browserName: 'chrome',
  },
];

config.services?.push('chromedriver');

export { config };
