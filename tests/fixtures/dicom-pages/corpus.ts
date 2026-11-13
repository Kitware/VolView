import {
  singleDecoderTable,
  wholeInstanceDecoder,
} from '@/packages/dicom/core';
import { createRuntime, failed, never, report, sourceOf } from './shared';
import { loadInstanceVolume } from './loadVolume';
import { describeVolume } from './describeVolume';

const customDecoder = wholeInstanceDecoder('Custom', () => ({
  size: [4, 4, 2],
  components: 1,
  data: new Uint16Array([...Array(16).fill(2), ...Array(16).fill(4)]),
}));

async function run() {
  const params = new URL(location.href).searchParams;
  const url = new URL(
    `./corpus-data/${encodeURIComponent(params.get('name')!)}`,
    document.baseURI
  );
  const input =
    params.get('source') === 'file'
      ? new File([await (await fetch(url)).blob()], 'volume.dcm')
      : url;
  const runtime = createRuntime(
    params.get('decoder') === 'custom'
      ? { decoders: () => singleDecoderTable(customDecoder) }
      : {}
  );
  const instance = await runtime.readInstance(sourceOf(input), never);
  const { volume, image } = await loadInstanceVolume(instance, {
    runtime,
    irregularGeometry:
      params.get('policy') === 'reject' ? 'reject' : 'preserve-order',
  });
  await describeVolume(image, report);
  report('reconstruction', volume.reconstruction.kind);
  report('status', 'complete');
}

run().catch(failed);
