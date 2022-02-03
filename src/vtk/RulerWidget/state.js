import vtkStateBuilder from '@kitware/vtk.js/Widgets/Core/StateBuilder';

export const InteractionState = Object.freeze({
  Initial: 1,
  PlacedFirst: 2,
  Complete: 3,
});

export function computeInteractionState(state) {
  const list = state.getHandleList();
  if (list.length === 0) {
    return InteractionState.Initial;
  }
  if (list.length === 1) {
    return InteractionState.PlacedFirst;
  }
  return InteractionState.Complete;
}

export default function generateState() {
  return vtkStateBuilder
    .createBuilder()
    .addStateFromMixin({
      labels: ['moveHandle'],
      mixins: ['origin', 'color', 'scale1', 'visible'],
      name: 'moveHandle',
      initialValues: {
        scale1: 30,
        origin: [0, 0, 0],
        visible: false,
      },
    })
    .addDynamicMixinState({
      labels: ['handles'],
      mixins: ['origin', 'color', 'scale1'],
      name: 'handle',
      initialValues: {
        scale1: 30,
        origin: [0, 0, 0],
      },
    })
    .build();
}
