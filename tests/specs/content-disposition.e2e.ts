import { volViewPage } from '../pageobjects/volview.page';
import { downloadFile } from './utils';
import { startServer, stopServer } from '../server/content-disposition-server';

const CT_ELECTRODES = {
  url: 'https://raw.githubusercontent.com/neurolabusc/niivue-images/main/CT_Electrodes.nii.gz',
  name: 'CT_Electrodes.nii.gz',
};

const SERVER_PORT = 4568;

describe('Content-Disposition header handling', () => {
  let server: ReturnType<typeof startServer>;

  before(async () => {
    await downloadFile(CT_ELECTRODES.url, CT_ELECTRODES.name);
    server = startServer();
  });

  after(async () => {
    if (server) {
      await stopServer(server);
    }
  });

  it('should use filename from Content-Disposition when URL has no extension', async () => {
    await volViewPage.open(`?urls=http://localhost:${SERVER_PORT}/scan`);
    await volViewPage.waitForViews();

    const notificationCount = await volViewPage.getNotificationsCount();
    expect(notificationCount).toBe(0);
  });

  it('should prefer Content-Disposition over URL extension', async () => {
    await volViewPage.open(`?urls=http://localhost:${SERVER_PORT}/scan.dcm`);
    await volViewPage.waitForViews();

    const notificationCount = await volViewPage.getNotificationsCount();
    expect(notificationCount).toBe(0);
  });
});
