import { createDicomLoader } from '@volview/dicom/core';
import { describeMetadata, failed, loadChunk, loader, report } from './shared';
import { fixtureBytes } from './fixtureData';

async function recoverWorker() {
  const recovering = createDicomLoader({
    assets: {
      pipelineWorkerUrl: new URL('./recovering-worker.js', document.baseURI)
        .href,
      imageIOUrl: new URL('./assets/image-io', document.baseURI).href,
    },
  });
  const file = new File(
    [fixtureBytes() as Uint8Array<ArrayBuffer>],
    'fixture.dcm'
  );
  try {
    const first = recovering.readDicomImage(file).then(
      () => report('first-error', 'unexpected success'),
      (error: Error) => report('first-error', error.message)
    );
    const queued = recovering.readDicomImage(file);
    const [, { image }] = await Promise.all([first, queued]);
    report('queued-pixels', Array.from(image.data).join(', '));
    const retry = await recovering.readDicomImage(file);
    report('retry-pixels', Array.from(retry.image.data).join(', '));
    report('status', 'complete');
  } finally {
    recovering.dispose();
  }
}

async function run() {
  const chunk = await loadChunk();
  describeMetadata(chunk);
  await chunk.loadData();
  const { image } = await loader.readDicomImage(
    new File([chunk.dataBlob!], 'fixture.dcm')
  );
  report('pixels', Array.from(image.data!).join(', '));
  report('dimensions', image.size.join(', '));
  report('status', 'complete');
}
const scenario = new URL(location.href).searchParams.get('scenario');
(scenario === 'worker-recovery' ? recoverWorker() : run()).catch(failed);
