import { config as sharedConfig, TEMP_DIR } from './wdio.shared.conf';

const IS_CI = !!(process.env.CI || process.env.GITHUB_ACTIONS);

// Chrome arguments for CI environments
const chromeArgs: string[] = [];
if (IS_CI) {
  chromeArgs.push(
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-infobars',
    '--enable-unsafe-swiftshader'
  );
}

if (!IS_CI && !process.env.HEADED) {
  chromeArgs.push('--headless=new', '--enable-unsafe-swiftshader');
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
