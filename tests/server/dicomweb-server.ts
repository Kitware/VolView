import express from 'express';
import cors from 'cors';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

export type Reply = {
  status: number;
  json?: unknown;
  dicoms?: Uint8Array[];
};

export type DicomWebReplies = {
  studySearch: Reply;
  seriesSearch: Reply;
  seriesMetadata: Reply;
  seriesRetrieval: Reply;
};

const BOUNDARY = 'volview-e2e-boundary';

// WADO-RS answers a series retrieval with one multipart/related part per instance.
const multipartRelated = (dicoms: Uint8Array[]) =>
  Buffer.concat([
    ...dicoms.flatMap((dicom) => [
      Buffer.from(`--${BOUNDARY}\r\nContent-Type: application/dicom\r\n\r\n`),
      Buffer.from(dicom),
      Buffer.from('\r\n'),
    ]),
    Buffer.from(`--${BOUNDARY}--`),
  ]);

const send = (res: express.Response, reply: Reply) => {
  if (reply.dicoms) {
    res
      .status(reply.status)
      .set(
        'Content-Type',
        `multipart/related; type="application/dicom"; boundary=${BOUNDARY}`
      )
      .send(multipartRelated(reply.dicoms));
    return;
  }
  res.status(reply.status).json(reply.json ?? null);
};

/**
 * Serves the DICOMweb routes VolView requests for a linked study or series,
 * answering each with whatever the spec last assigned to `replies`.
 */
export async function startDicomWebServer() {
  const replies: DicomWebReplies = {
    studySearch: { status: 404 },
    seriesSearch: { status: 404 },
    seriesMetadata: { status: 404 },
    seriesRetrieval: { status: 404 },
  };

  const app = express();
  app.use(cors());
  app.get('/dicom-web/studies', (_req, res) => send(res, replies.studySearch));
  app.get('/dicom-web/studies/:study/series', (_req, res) =>
    send(res, replies.seriesSearch)
  );
  app.get('/dicom-web/studies/:study/series/:series/metadata', (_req, res) =>
    send(res, replies.seriesMetadata)
  );
  app.get('/dicom-web/studies/:study/series/:series', (_req, res) =>
    send(res, replies.seriesRetrieval)
  );

  // Port 0 so specs in parallel workers never contend for the shared AUX_PORT.
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  const { port } = server.address() as AddressInfo;

  return {
    replies,
    root: `http://localhost:${port}/dicom-web`,
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
