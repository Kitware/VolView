import '@kitware/vtk.js/Rendering/Profiles/Volume';
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkImageMapper from '@kitware/vtk.js/Rendering/Core/ImageMapper';
import vtkImageSlice from '@kitware/vtk.js/Rendering/Core/ImageSlice';
import { describeMetadata, failed, loadChunk, report } from './shared';
import { loadVolume } from './loadVolume';

async function run() {
  const chunk = await loadChunk();
  describeMetadata(chunk);
  const image = await loadVolume(chunk);

  const data = image.getVtkImageData();
  report('dimensions', data.getDimensions().join(', '));
  report('spacing', data.getSpacing().join(', '));
  report('origin', data.getOrigin().join(', '));
  report('range', data.getPointData().getScalars().getRange().join(', '));
  const view = vtkGenericRenderWindow.newInstance({ background: [0, 0, 0] });
  view.setContainer(document.querySelector('#viewport') as HTMLElement);
  view.resize();
  const mapper = vtkImageMapper.newInstance();
  mapper.setInputData(data);
  mapper.setKSlice(0);
  const actor = vtkImageSlice.newInstance();
  actor.setMapper(mapper);
  actor.getProperty().setColorWindow(20);
  actor.getProperty().setColorLevel(-10);
  const renderer = view.getRenderer();
  renderer.addActor(actor);
  renderer.getActiveCamera().setParallelProjection(true);
  renderer.resetCamera();
  renderer.resetCameraClippingRange();
  view.getRenderWindow().render();
  report('status', 'complete');

  window.addEventListener(
    'pagehide',
    () => {
      view.delete();
      actor.delete();
      mapper.delete();
      image.dispose();
    },
    { once: true }
  );
}
run().catch(failed);
