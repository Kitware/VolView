const instanceMap = new Map<Symbol, any>();

export function setCurrentInstance<T>(name: Symbol, instance: any) {
  instanceMap.set(name, instance);
  return instance as T;
}

export function getCurrentInstance<T>(name: Symbol) {
  return instanceMap.get(name) as T;
}
