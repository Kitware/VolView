import express from 'express';
import cors from 'cors';
import { readFileSync } from 'fs';
import { join } from 'path';

const PORT = 4568;
const TEMP_DIR = '.tmp';

export function createContentDispositionServer() {
  const app = express();

  app.use(
    cors({
      origin: '*',
      exposedHeaders: ['Content-Disposition'],
    })
  );

  app.get('/scan', (req, res) => {
    const filePath = join(TEMP_DIR, 'CT_Electrodes.nii.gz');
    const fileBuffer = readFileSync(filePath);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="CT_Electrodes.nii.gz"'
    );
    res.send(fileBuffer);
  });

  return app;
}

export function startServer() {
  const app = createContentDispositionServer();
  return app.listen(PORT, () => {
    console.log(`Content-Disposition test server running on port ${PORT}`);
  });
}

export function stopServer(server: ReturnType<typeof startServer>) {
  return new Promise<void>((resolve) => {
    server.close(() => {
      console.log('Content-Disposition test server stopped');
      resolve();
    });
  });
}
