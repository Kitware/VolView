import { computed } from '@vue/composition-api';
import { mat4, quat, vec3 } from 'gl-matrix';

export function defer() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

/**
 * Turns an action into a mutation wrapper
 * @param {string} mutation
 */
export function asMutation(mutation) {
  return ({ commit }, args) => commit(mutation, args);
}

/**
 * Picks out a subset of an object
 * @param {Object} obj
 * @param {String[]} keys
 */
export function pick(obj, keys) {
  return keys.reduce((o, k) => ({ ...o, [k]: obj[k] }), {});
}

/**
 * Zips a list of keys and a list of values into an object.
 * @param {String[]} keys
 * @param {any[]} values
 */
export function zipObj(keys, values) {
  const obj = {};
  const length = Math.min(keys.length, values.length);
  for (let i = 0; i < length; i += 1) {
    obj[keys[i]] = values[i];
  }
  return obj;
}

export function zip(...lists) {
  const out = [];
  const maxLength = lists.reduce((max, l) => Math.max(max, l.length), 0);
  for (let i = 0; i < maxLength; i += 1) {
    const tmp = [];
    for (let j = 0; j < lists.length; j += 1) {
      tmp.push(lists[j][i]);
    }
    out.push(tmp);
  }
  return out;
}

export function unsubscribeVtkList(subs) {
  while (subs.length) {
    subs.pop().unsubscribe();
  }
}

/**
 * Rotates vector from image index space to world dir.
 * @param {vtkImageData} imageData
 * @param {vec3} vec
 */
export function indexToWorldRotation(imageData, vec) {
  const i2wMat = imageData.getIndexToWorld();
  const rotation = quat.create();
  mat4.getRotation(rotation, i2wMat);

  const out = vec3.create();
  vec3.transformQuat(out, vec, rotation);
  return out;
}

/**
 * Unpacks an object returned by vue's computed, and makes each
 * individual key a separate ref.
 */
export function multiComputed(fn) {
  const obj = computed(fn);
  const a = Object.keys(obj.value).reduce(
    (acc, key) => ({
      ...acc,
      [key]: computed(() => obj.value[key]),
    }),
    {}
  );
  return a;
}
