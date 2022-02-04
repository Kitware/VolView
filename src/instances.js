const instanceMap = new Map();

export function setCurrentInstance(name, instance) {
  instanceMap.set(name, instance);
  return instance;
}

export function getCurrentInstance(name) {
  return instanceMap.get(name);
}
