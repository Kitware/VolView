import vtkStateBuilder from 'vtk.js/Sources/Widgets/Core/StateBuilder';

export default function generateState() {
  return vtkStateBuilder
    .createBuilder()
    .addField({
      name: 'placed',
      initialValue: false,
    })
    .addField({
      name: 'indexToWorldTransform',
      initialValue: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    })
    .addField({
      name: 'worldToIndexTransform',
      initialValue: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    })
    .addStateFromMixin({
      labels: ['handle'],
      mixins: ['origin', 'color', 'scale1', 'visible', 'bounds'],
      name: 'handle',
      initialValues: {
        scale1: 30,
        origin: [-1, -1, -1],
        visible: false,
      },
    })
    .build();
}
