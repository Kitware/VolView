type FlowFunction<T> = (o: T) => T;

export function flow<T>(...fns: Array<FlowFunction<T>>) {
  return (input: T) => fns.reduce((result, fn) => fn(result), input);
}

// Pipe code from
// https://dev.to/ecyrbe/how-to-use-advanced-typescript-to-define-a-pipe-function-381h
// Changed second parameter to rest/spread argument.
type AnyFunc = (...arg: any) => any;

type LastFnReturnType<F extends Array<AnyFunc>, Else = never> = F extends [
  ...any[],
  (...arg: any) => infer R
]
  ? R
  : Else;

type PipeArgs<F extends AnyFunc[], Acc extends AnyFunc[] = []> = F extends [
  (...args: infer A) => infer B
]
  ? [...Acc, (...args: A) => B]
  : F extends [(...args: infer A) => any, ...infer Tail]
  ? Tail extends [(arg: infer B) => any, ...any[]]
    ? PipeArgs<Tail, [...Acc, (...args: A) => B]>
    : Acc
  : Acc;

// Example:
// const myNumber = pipe(
//   "1",
//   (a: string) => Number(a),
//   (c: number) => c + 1,
//   (d: number) => `${d}`,
//   (e: string) => Number(e)
// );
export function pipe<F extends AnyFunc[]>(
  arg: Parameters<F[0]>[0],
  ...fns: PipeArgs<F> extends F ? F : PipeArgs<F>
): LastFnReturnType<F, ReturnType<F[0]>> {
  return (fns.slice(1) as AnyFunc[]).reduce((acc, fn) => fn(acc), fns[0](arg));
}
