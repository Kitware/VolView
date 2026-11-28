import { test, expect } from '../fixtures';
import { startServer, stopServer } from '../server/content-disposition-server';
import { AUX_PORT as SERVER_PORT } from '../e2ePorts';

test.describe('Content-Disposition header handling', () => {
  let server: ReturnType<typeof startServer>;

  test.beforeAll(async () => {
    server = startServer();
  });

  test.afterAll(async () => {
    if (server) {
      await stopServer(server);
    }
  });

  test('should use filename from Content-Disposition when URL has no extension', async ({
    volview,
  }) => {
    await volview.open(`?urls=http://localhost:${SERVER_PORT}/scan`);
    await volview.waitForViews();

    const notificationCount = await volview.getNotificationsCount();
    expect(notificationCount).toBe(0);
  });
});
