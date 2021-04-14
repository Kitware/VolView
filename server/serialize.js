export const SKIP = Symbol('skip');

export function vtkObjectReplacer(vo) {
  if (!vo?.isA?.('vtkObject')) return SKIP;
  return vo.getState();
}

export function vtkDataArrayJSONReplacer(da, attach) {
  if (da?.classHierarchy?.includes?.('vtkDataArray')) {
    const values = new globalThis[da.dataType](da.values);
    return {
      ...da,
      values: attach(values),
    };
  }
  return SKIP;
}

const REPLACERS = [vtkObjectReplacer, vtkDataArrayJSONReplacer];

export function serialize(obj, attach) {
  return JSON.parse(
    JSON.stringify(obj, (key, value) => {
      for (let i = 0; i < REPLACERS.length; i += 1) {
        const result = REPLACERS[i](value, attach);
        if (result !== SKIP) {
          return result;
        }
      }
      return value;
    })
  );
}
