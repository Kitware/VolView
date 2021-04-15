import vtk from 'vtk.js/Sources/vtk';

export const BREAK = Symbol('Break');

export function vtkObjectReplacer(vo) {
  if (vo?.isA?.('vtkObject')) {
    return vo.getState();
  }
  return vo;
}

export function vtkDataArrayJSONReplacer(da, attach) {
  if (da?.classHierarchy?.includes?.('vtkDataArray')) {
    const values = new globalThis[da.dataType](da.values);
    return {
      ...da,
      values: attach(values),
    };
  }
  return da;
}

/**
 * Serializes typed arrays into regular arrays
 */
export function typedArrayReplacer(ta) {
  if (ArrayBuffer.isView(ta) && !(ta instanceof DataView)) {
    return Array.from(ta);
  }
  return ta;
}

export async function vtkDataArrayValueReviver(da) {
  if (da?.vtkClass === 'vtkDataArray' && da?.values instanceof Blob) {
    const ab = await da.values.arrayBuffer();
    return {
      ...da,
      values: new globalThis[da.dataType](ab),
    };
  }
  return da;
}

export function vtkObjectReviver(obj) {
  if ('vtkClass' in obj) {
    return vtk(obj);
  }
  return obj;
}

const REPLACERS = [
  vtkObjectReplacer,
  vtkDataArrayJSONReplacer,
  typedArrayReplacer,
];

const REVIVERS = [
  vtkDataArrayValueReviver,
  // should be after the vtkDataArrayValueReviver
  vtkObjectReviver,
];

export function serialize(obj, attach) {
  return JSON.parse(
    JSON.stringify(obj, (key, value) => {
      let transformed = value;
      for (let i = 0; i < REPLACERS.length; i += 1) {
        const result = REPLACERS[i](transformed, attach);
        if (result === BREAK) {
          break;
        }
        transformed = result;
      }
      return transformed;
    })
  );
}

export async function deserialize(obj) {
  async function revive(o) {
    let transformed = o;
    for (let i = 0; i < REVIVERS.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const result = await REVIVERS[i](transformed);
      if (result === BREAK) {
        break;
      }
      transformed = result;
    }
    return transformed;
  }

  async function recurseHelper(o) {
    if (Array.isArray(o)) {
      const newArray = await Promise.all(o.map((item) => recurseHelper(item)));
      return revive(newArray);
    }
    if (o instanceof Object && o.constructor === Object) {
      const newO = {};
      await Promise.all(
        Object.keys(o).map(async (k) => {
          newO[k] = await recurseHelper(o[k]);
        })
      );
      return revive(newO);
    }
    return o;
  }

  return recurseHelper(obj);
}
