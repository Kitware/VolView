import { failed, never, report, runtime, sourceOf } from './shared';
import { loadInstanceVolume } from './loadVolume';
import { describeVolume } from './describeVolume';

async function run() {
  const params = new URL(location.href).searchParams;
  const source = params.get('source');
  const url = new URL(
    `./${source === 'unranged' ? 'unranged-data' : 'corpus-data'}/${encodeURIComponent(params.get('name')!)}`,
    document.baseURI
  );
  const input =
    source === 'file'
      ? new File([await (await fetch(url)).blob()], 'volume.dcm')
      : url;
  const instance = await runtime.readInstance(sourceOf(input), never);
  const { update, image } = await loadInstanceVolume(instance);
  await describeVolume(image, report);
  report('reconstruction', update.collection.reconstruction.kind);
  report('status', 'complete');
}

run().catch(failed);
