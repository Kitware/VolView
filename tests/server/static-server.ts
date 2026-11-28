import express from 'express';

// Run by node directly from playwright.config.ts, so it imports nothing that
// needs a TypeScript resolver.
const [port, distDir, tmpDir] = process.argv.slice(2);

const app = express();
app.use('/', express.static(distDir));
app.use('/tmp', express.static(tmpDir));
app.listen(Number(port));
