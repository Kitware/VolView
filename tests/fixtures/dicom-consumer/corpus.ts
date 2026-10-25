import { failed, loader, report } from './shared';
import { loadVolume } from './loadVolume';
import { describeVolume } from './describeVolume';
import { VtkDicomImage } from '@volview/dicom/vtk';

async function run() {
  const params = new URL(location.href).searchParams;
  const url = new URL(
    `./corpus-data/${encodeURIComponent(params.get('name')!)}`,
    document.baseURI
  );
  const source =
    params.get('source') === 'file'
      ? new File([await (await fetch(url)).blob()], 'volume.dcm')
      : url;
  const chunk = loader.createChunk(source);
  const read =
    params.get('decoder') === 'custom'
      ? async () => ({
          image: {
            size: [4, 4, 2],
            imageType: { components: 1 },
            data: new Uint16Array([...Array(16).fill(2), ...Array(16).fill(4)]),
          },
        })
      : loader.readDicomImage;
  const image = new VtkDicomImage({
    readDicomImage: read,
    irregularGeometry:
      params.get('policy') === 'reject' ? 'reject' : 'preserve-order',
  });
  const volume = await loadVolume(chunk, image);
  try {
    await describeVolume(volume, report);
    report('reconstruction', volume.getReconstruction()!.kind);
    report('status', 'complete');
  } finally {
    volume.dispose();
    loader.dispose();
  }
}

run().catch(failed);
