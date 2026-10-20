import { config as sharedConfig, TEMP_DIR } from './wdio.shared.conf';

const IS_CI = !!(process.env.CI || process.env.GITHUB_ACTIONS);
const IS_HEADLESS = process.env.HEADED !== '1';

const chromeArgs: string[] = [];
if (IS_CI) {
  chromeArgs.push(
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-infobars'
  );
}

if (IS_HEADLESS) {
  chromeArgs.push('--headless=new');
}

if (IS_CI || IS_HEADLESS) {
  chromeArgs.push('--enable-unsafe-swiftshader');
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
