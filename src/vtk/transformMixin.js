export default function vtkRepresentationProxyTransformMixin(
  vtkTransformFilter
) {
  return (publicAPI, model) => {
    model.transformFilter = vtkTransformFilter.newInstance();
    model.superSourceDependencies = model.sourceDependencies;
    model.sourceDependencies = [
      {
        setInputData(data) {
          model.transformFilter.setInputData(data);
          publicAPI.updateDependencies();
        },
      },
    ];

    publicAPI.updateDependencies = () => {
      model.superSourceDependencies.forEach((dep) => {
        dep.setInputData(model.transformFilter.getOutputData());
      });
    };

    publicAPI.getTransform = model.transformFilter.getTransform;

    publicAPI.setTransform = (...args) => {
      if (model.transformFilter.setTransform(...args)) {
        publicAPI.updateDependencies();
        publicAPI.modified();
        return true;
      }
      return false;
    };
  };
}
