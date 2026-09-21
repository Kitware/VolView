import { volViewPage } from '../pageobjects/volview.page';
import { startServer, stopServer } from '../server/content-disposition-server';
import { AUX_PORT as SERVER_PORT } from '../e2ePorts';

describe('Content-Disposition header handling', () => {
  let server: ReturnType<typeof startServer>;

  before(async () => {
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
});
