export type PipeFunction<T> = (o: T) => T;

export default function pipe<T>(...fns: Array<PipeFunction<T>>) {
  return (input: T) => fns.reduce((result, fn) => fn(result), input);
}
