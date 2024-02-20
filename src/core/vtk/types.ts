export type VtkObjectConstructor<T> = {
  newInstance(props?: any): T;
};
