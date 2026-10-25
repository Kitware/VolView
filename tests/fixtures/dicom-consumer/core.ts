import { describeMetadata, failed, loadChunk, loader, report } from './shared';

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
run().catch(failed);
