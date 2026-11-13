import { fromBlob, readBytes } from '@/packages/dicom/core';
import {
  assetUrls,
  createRuntime,
  firstUnit,
  describeMetadata,
  failed,
  gdcmOnly,
  loadInstance,
  never,
  report,
} from './shared';
import { fixtureBytes } from './fixtureData';

async function recoverWorker() {
  const recovering = createRuntime({
    assets: assetUrls('./recovering-worker.js'),
    decodeConcurrency: 1,
    ...gdcmOnly,
  });
  const file = new File(
    [fixtureBytes() as Uint8Array<ArrayBuffer>],
    'fixture.dcm'
  );
  const instance = await recovering.readInstance(fromBlob(file), never);
  // Decoding may transfer the bytes away, so each decode reads its own. Both
  // are read before either decode starts, so the first call takes the lane
  // whose worker fails.
  const readCopy = () => readBytes(instance.source, never);
  const decode = async (bytes: Uint8Array) =>
    firstUnit(recovering, instance).decode(bytes, never);
  const [firstBytes, queuedBytes] = await Promise.all([readCopy(), readCopy()]);
  const first = decode(firstBytes).then(
    () => report('first-error', 'unexpected success'),
    (error: Error) => report('first-error', error.message)
  );
  const queued = decode(queuedBytes);
  const [, image] = await Promise.all([first, queued]);
  report('queued-pixels', Array.from(image.data).join(', '));
  const retry = await decode(await readCopy());
  report('retry-pixels', Array.from(retry.data).join(', '));
  report('status', 'complete');
}

async function run() {
  const instance = await loadInstance();
  describeMetadata(instance);
  const bytes = await readBytes(instance.source, never);
  const image = await firstUnit(createRuntime(gdcmOnly), instance).decode(
    bytes,
    never
  );
  report('pixels', Array.from(image.data).join(', '));
  report('dimensions', image.size.join(', '));
  report('status', 'complete');
}
const scenario = new URL(location.href).searchParams.get('scenario');
(scenario === 'worker-recovery' ? recoverWorker() : run()).catch(failed);
