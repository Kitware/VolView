import { config as sharedConfig, TEMP_DIR } from './wdio.shared.conf';

// Chrome arguments for CI environments
const chromeArgs: string[] = [];
if (process.env.CI || process.env.GITHUB_ACTIONS) {
  chromeArgs.push(
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-infobars'
  );
}

export const config = {
  ...sharedConfig,
  capabilities: [
    {
      browserName: 'chrome',
      // this overrides the default chrome download directory with our temporary one
      'goog:chromeOptions': {
        args: chromeArgs,
        prefs: {
          directory_upgrade: true,
          prompt_for_download: false,
          'download.default_directory': TEMP_DIR,
        },
      },
    },
  ],
};
