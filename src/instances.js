const instanceMap = new Map();

export function setCurrent(name, instance) {
  instanceMap.set(name, instance);
  return instance;
}

export function getCurrent(name) {
  return instanceMap.get(name);
}
