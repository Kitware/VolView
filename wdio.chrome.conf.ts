import { config, TEMP_DIR } from './wdio.shared.conf';

config.capabilities = [
  {
    browserName: 'chrome',
    // this overrides the default chrome download directory with our temporary one
    'goog:chromeOptions': {
      prefs: {
        directory_upgrade: true,
        prompt_for_download: false,
        'download.default_directory': TEMP_DIR,
      },
    },
  },
];

config.services?.push('chromedriver');

export { config };
